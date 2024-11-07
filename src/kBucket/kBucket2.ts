import { Peer } from "../peer/peer.js";
import { PeerDistanceList } from "../peer/peerDistanceList";
import { XOR } from "../utils/nodeUtils.js";
import map from "it-map";

export const KBUCKET_SIZE = 8;
export const PREFIX_LENGTH = 8;
export const PING_NEW_CONTACT_TIMEOUT = 2000;
export const PING_NEW_CONTACT_CONCURRENCY = 20;
export const PING_NEW_CONTACT_MAX_QUEUE_SIZE = 100;
export const PING_OLD_CONTACT_COUNT = 3;
export const PING_OLD_CONTACT_TIMEOUT = 2000;
export const PING_OLD_CONTACT_CONCURRENCY = 20;
export const PING_OLD_CONTACT_MAX_QUEUE_SIZE = 100;
export const KAD_PEER_TAG_NAME = "kad-peer";
export const KAD_PEER_TAG_VALUE = 1;
export const LAST_PING_THRESHOLD = 600000;
export const POPULATE_FROM_DATASTORE_ON_START = true;
export const POPULATE_FROM_DATASTORE_LIMIT = 1000;
export interface PingFunction {
	/**
	 * Return either none or at least one contact that does not respond to a ping
	 * message
	 */
	(oldContacts: Peer[], options?: any): AsyncGenerator<Peer>;
}

/**
 * Before a peer can be added to the table, verify that it is online and working
 * correctly
 */
export interface VerifyFunction {
	(contact: Peer, options?: any): Promise<boolean>;
}

export interface OnAddCallback {
	/**
	 * Invoked when a new peer is added to the routing tables
	 */
	(peer: Peer, bucket: LeafBucket): Promise<void>;
}

export interface OnRemoveCallback {
	/**
	 * Invoked when a peer is evicted from the routing tables
	 */
	(peer: Peer, bucket: LeafBucket): Promise<void>;
}

export interface OnMoveCallback {
	/**
	 * Invoked when a peer is moved between buckets in the routing tables
	 */
	(peer: Peer, oldBucket: LeafBucket, newBucket: LeafBucket): Promise<void>;
}

export interface KBucketOptions {
	/**
	 * The current peer. All subsequently added peers must have a nodeId that is
	 * the same length as this peer.
	 */
	// localPeer: Peer

	/**
	 * How many bits of the key to use when forming the bucket trie. The larger
	 * this value, the deeper the tree will grow and the slower the lookups will
	 * be but the peers returned will be more specific to the key.
	 *
	 * @default 8
	 */
	prefixLength?: number;

	/**
	 * The number of nodes that a max-depth k-bucket can contain before being
	 * full.
	 *
	 * @default 20
	 */
	kBucketSize?: number;

	/**
	 * The number of nodes that an intermediate k-bucket can contain before being
	 * split.
	 *
	 * @default kBucketSize
	 */
	splitThreshold?: number;

	/**
	 * The number of nodes to ping when a bucket that should not be split becomes
	 * full. KBucket will emit a `ping` event that contains
	 * `numberOfOldContactsToPing` nodes that have not been contacted the longest.
	 *
	 * @default 3
	 */
	numberOfOldContactsToPing?: number;

	/**
	 * Do not re-ping a peer during this time window in ms
	 *
	 * @default 600000
	 */
	lastSeenThreshold?: number;

	ping: PingFunction;
	verify: VerifyFunction;
	onAdd?: OnAddCallback;
	onRemove?: OnRemoveCallback;
}

export interface LeafBucket {
	prefix: string;
	depth: number;
	peers: Peer[];
}

export interface InternalBucket {
	prefix: string;
	depth: number;
	left: Bucket;
	right: Bucket;
}

export type Bucket = LeafBucket | InternalBucket;

export function isLeafBucket(obj: any): obj is LeafBucket {
	return Array.isArray(obj?.peers);
}

/**
 * Implementation of a Kademlia DHT routing table as a prefix binary trie with
 * configurable prefix length, bucket split threshold and size.
 */
export class KBucket {
	public root: Bucket;
	public localPeer?: Peer;
	private readonly prefixLength: number;
	private readonly splitThreshold: number;
	private readonly kBucketSize: number;
	private readonly numberOfNodesToPing: number;
	private readonly lastSeenThreshold: number;
	public ping: PingFunction;
	public verify: VerifyFunction;
	private readonly onAdd?: OnAddCallback;
	private readonly onRemove?: OnRemoveCallback;
	private readonly onMove?: OnMoveCallback;
	private readonly addingPeerMap: Map<any, any>;

	constructor(options: KBucketOptions) {
		this.prefixLength = options.prefixLength ?? PREFIX_LENGTH;
		this.kBucketSize = options.kBucketSize ?? KBUCKET_SIZE;
		this.splitThreshold = options.splitThreshold ?? this.kBucketSize;
		this.numberOfNodesToPing = options.numberOfOldContactsToPing ?? PING_OLD_CONTACT_COUNT;
		this.lastSeenThreshold = options.lastSeenThreshold ?? LAST_PING_THRESHOLD;
		this.ping = options.ping;
		this.verify = options.verify;
		this.onAdd = options.onAdd;
		this.onRemove = options.onRemove;
		this.addingPeerMap = new Map();

		this.root = {
			prefix: "",
			depth: 0,
			peers: [],
		};
	}

	async addSelfPeer(peer: Peer): Promise<void> {
		this.localPeer = peer;
		peer.updateLastSeen();
	}

	/**
	 * Adds a contact to the trie
	 */
	async add(peer: Peer, options?: any): Promise<void> {
		const nodeId = peer.nodeId;

		const existingPromise = this.addingPeerMap.get(nodeId);

		if (existingPromise != null) {
			return existingPromise;
		}

		try {
			const p = this._add(peer, options);
			this.addingPeerMap.set(nodeId, p);
			await p;
		} finally {
			this.addingPeerMap.delete(nodeId);
		}
	}

	private async _add(peer: Peer, options?: any): Promise<void> {
		const bucket = this._determineBucket(peer.nodeId);

		// check if the contact already exists
		if (this._indexOf(bucket, peer.nodeId) > -1) {
			return;
		}

		// are there too many peers in the bucket and can we make the trie deeper?
		if (bucket.peers.length === this.splitThreshold && bucket.depth < this.prefixLength) {
			// split the bucket
			await this._split(bucket);

			// try again
			await this._add(peer, options);

			return;
		}

		// is there space in the bucket?
		if (bucket.peers.length < this.kBucketSize) {
			// we've ping this peer previously, just add them to the bucket
			if (!needsPing(peer, this.lastSeenThreshold)) {
				bucket.peers.push(peer);
				await this.onAdd?.(peer, bucket);
				return;
			}

			const result = await this.verify(peer, options);

			// only add if peer is online and functioning correctly
			if (result) {
				peer.lastSeen = Date.now();

				// try again - buckets may have changed during ping
				await this._add(peer, options);
			}

			return;
		}

		// we are at the bottom of the trie and the bucket is full so we can't add
		// any more peers.
		//
		// instead ping the first `this.numberOfNodesToPing` in order to determine
		// if they are still online.
		//
		// only add the new peer if one of the pinged nodes does not respond, this
		// prevents DoS flooding with new invalid contacts.
		const toPing = bucket.peers
			.filter((peer) => {
				if (peer.nodeId === this.localPeer?.nodeId) {
					return false;
				}

				if (peer.lastSeen > Date.now() - this.lastSeenThreshold) {
					return false;
				}

				return true;
			})
			.sort((a, b) => {
				// sort oldest ping -> newest
				if (a.lastSeen < b.lastSeen) {
					return -1;
				}

				if (a.lastSeen > b.lastSeen) {
					return 1;
				}

				return 0;
			})
			.slice(0, this.numberOfNodesToPing);

		let evicted = false;

		for await (const toEvict of this.ping(toPing, options)) {
			evicted = true;
			await this.remove(toEvict.nodeId);
		}

		// did not evict any peers, cannot add new contact
		if (!evicted) {
			return;
		}

		// try again - buckets may have changed during ping
		await this._add(peer, options);
	}

	/**
	 * Get 0-n closest contacts to the provided node id. "Closest" here means:
	 * closest according to the XOR metric of the contact node id.
	 *
	 * @param {Uint8Array} id - Contact node id
	 * @returns {Generator<Peer, void, undefined>} Array Maximum of n closest contacts to the node id
	 */
	*closest(id: number, n: number = this.kBucketSize): Generator<Peer, void, undefined> {
		const list = new PeerDistanceList(id, n);

		for (const peer of this.toIterable()) {
			list.addWitKadId(peer, peer.nodeId);
		}

		yield* map(list.peers, (info) => info);
	}

	/**
	 * Counts the total number of contacts in the tree.
	 *
	 * @returns {number} The number of contacts held in the tree
	 */
	count(): number {
		function countBucket(bucket: Bucket): number {
			if (isLeafBucket(bucket)) {
				return bucket.peers.length;
			}

			let count = 0;

			if (bucket.left != null) {
				count += countBucket(bucket.left);
			}

			if (bucket.right != null) {
				count += countBucket(bucket.right);
			}

			return count;
		}

		return countBucket(this.root);
	}

	/**
	 * Get a contact by its exact ID.
	 * If this is a leaf, loop through the bucket contents and return the correct
	 * contact if we have it or null if not. If this is an inner node, determine
	 * which branch of the tree to traverse and repeat.
	 *
	 * @param {Uint8Array} nodeId - The ID of the contact to fetch.
	 * @returns {Peer | undefined} The contact if available, otherwise null
	 */
	get(nodeId: number): Peer | undefined {
		const bucket = this._determineBucket(nodeId);
		const index = this._indexOf(bucket, nodeId);

		return bucket.peers[index];
	}

	/**
	 * Removes contact with the provided id.
	 *
	 * @param {Uint8Array} nodeId - The ID of the contact to remove
	 */
	async remove(nodeId: number): Promise<void> {
		const bucket = this._determineBucket(nodeId);
		const index = this._indexOf(bucket, nodeId);

		if (index > -1) {
			const peer = bucket.peers.splice(index, 1)[0];

			await this.onRemove?.(peer, bucket);
		}
	}

	/**
	 * Similar to `toArray()` but instead of buffering everything up into an
	 * array before returning it, yields contacts as they are encountered while
	 * walking the tree.
	 *
	 * @returns {Iterable} All of the contacts in the tree, as an iterable
	 */
	*toIterable(): Generator<Peer, void, undefined> {
		function* iterate(bucket: Bucket): Generator<Peer, void, undefined> {
			if (isLeafBucket(bucket)) {
				yield* bucket.peers;
				return;
			}

			yield* iterate(bucket.left);
			yield* iterate(bucket.right);
		}

		yield* iterate(this.root);
	}

	/**
	 * Default distance function. Finds the XOR distance between firstId and
	 * secondId.
	 *
	 * @param  {Uint8Array} firstId - Uint8Array containing first id.
	 * @param  {Uint8Array} secondId - Uint8Array containing second id.
	 * @returns {number} Integer The XOR distance between firstId and secondId.
	 */
	distance(firstId: number, secondId: number): bigint {
		return BigInt("0x" + `${XOR(firstId, secondId)}, "base16"`);
	}

	/**
	 * Determines whether the id at the bitIndex is 0 or 1
	 * Return left leaf if `id` at `bitIndex` is 0, right leaf otherwise
	 *
	 * @param {Uint8Array} nodeId - Id to compare localNodeId with
	 * @returns {LeafBucket} left leaf if id at bitIndex is 0, right leaf otherwise.
	 */
	private _determineBucket(nodeId: number): LeafBucket {
		// Convert the number to a binary string.
		const bitString = nodeId.toString(2); // Converts number to binary string.

		// Pad the bit string with leading zeros to make sure it has the same length (if needed).
		const paddedBitString = bitString.padStart(256, "0"); // Assuming a 256-bit nodeId, adjust as necessary.

		function findBucket(bucket: Bucket, bitIndex: number = 0): LeafBucket {
			if (isLeafBucket(bucket)) {
				return bucket;
			}

			const bit = paddedBitString[bitIndex]; // Get the current bit (as a string '0' or '1').

			if (bit === "0") {
				return findBucket(bucket.left, bitIndex + 1);
			}

			return findBucket(bucket.right, bitIndex + 1);
		}

		return findBucket(this.root);
	}

	/**
	 * Returns the index of the contact with provided
	 * id if it exists, returns -1 otherwise.
	 *
	 * @param {object} bucket - internal object that has 2 leafs: left and right
	 * @param {Uint8Array} nodeId - nodeId of peer
	 * @returns {number} Integer Index of contact with provided id if it exists, -1 otherwise.
	 */
	private _indexOf(bucket: LeafBucket, nodeId: number): number {
		return bucket.peers.findIndex((peer) => peer.nodeId === nodeId);
	}

	/**
	 * Modify the bucket, turn it from a leaf bucket to an internal bucket
	 *
	 * @param {any} bucket - bucket for splitting
	 */
	private async _split(bucket: LeafBucket): Promise<void> {
		// create child buckets
		const left: LeafBucket = {
			prefix: "0",
			depth: bucket.depth + 1,
			peers: [],
		};
		const right: LeafBucket = {
			prefix: "1",
			depth: bucket.depth + 1,
			peers: [],
		};

		// redistribute peers
		for (const peer of bucket.peers) {
			const bitString = peer.nodeId.toString();

			if (bitString[bucket.depth] === "0") {
				left.peers.push(peer);
				await this.onMove?.(peer, bucket, left);
			} else {
				right.peers.push(peer);
				await this.onMove?.(peer, bucket, right);
			}
		}

		// convert old leaf bucket to internal bucket
		convertToInternalBucket(bucket, left, right);
	}
}

function convertToInternalBucket(bucket: any, left: any, right: any): bucket is InternalBucket {
	delete bucket.peers;
	bucket.left = left;
	bucket.right = right;

	if (bucket.prefix === "") {
		delete bucket.depth;
		delete bucket.prefix;
	}

	return true;
}

function needsPing(peer: Peer, threshold: number): boolean {
	return peer.lastSeen < Date.now() - threshold;
}
