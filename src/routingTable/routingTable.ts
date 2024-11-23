import { KBucket } from "../kBucket/kBucket";
import { MessagePayload, UDPDataInfo } from "../message/message";
import { ALPHA, BIT_SIZE, HASH_SIZE } from "../node/constants";
import KademliaNode from "../node/node";
import { Peer } from "../peer/peer";
import { XOR } from "../utils/nodeUtils";

type CloseNodes = {
	distance: number;
	node: Peer;
};

class RoutingTable {
	public buckets: Map<number, KBucket>;
	public readonly tableId: number;
	public readonly node: KademliaNode;

	private readonly store: Map<number, string>;

	constructor(tableId: number, node: KademliaNode) {
		this.tableId = tableId;
		this.buckets = new Map();
		this.store = new Map();
		this.node = node;
	}

	public getAllPeers = () => {
		const peers: Peer[] = [];
		for (const [_, nodes] of this.buckets.entries()) {
			for (const peer of nodes.nodes) {
				peers.push(peer);
			}
		}
		return peers;
	};

	public findBucket = (peer: Peer) => {
		const bucketIndex = this.getBucketIndex(peer.nodeId);
		const bucket = this.buckets.get(bucketIndex);

		if (!bucket) {
			const newBucket = new KBucket(bucketIndex, this.tableId, this.node);
			this.buckets.set(bucketIndex, newBucket);
			return newBucket;
		}
		return bucket;
	};

	public async updateTables(contact: Peer | Peer[]) {
		const contacts = Array.isArray(contact) ? contact : [contact];
		const promises: Array<Promise<unknown>> = [];

		for (const c of contacts) {
			const bucket = this.findBucket(c);
			promises.push(bucket.updateBucketNode(c));
		}

		await Promise.all(contacts);
	}

	public removeBucket = (bucketIndex: number) => {
		// const bucketIndex = this.getBucketIndex(peer.nodeId);
		this.buckets.delete(bucketIndex);
	};

	public containsBucket = (peer: Peer) => {
		const bucketIndex = this.getBucketIndex(peer.nodeId);
		this.buckets.has(bucketIndex);
	};

	public getAllBuckets = () => {
		let bucketsJson: {
			[key: number]: typeof KBucket.prototype.toJSON.prototype;
		} = {};
		for (const bucket of this.buckets.values()) {
			bucketsJson[bucket.bucketId] = bucket.toJSON();
		}
		return bucketsJson;
	};

	public getAllBucketsLen = () => {
		return Array.from(this.buckets.keys()).length;
	};

	public findClosestNode = (targetId: number): Peer | null => {
		let closestNode: Peer | null = null;
		let closestDistance: number | null = null;

		for (const [_, nodes] of this.buckets.entries()) {
			for (const peer of nodes.nodes) {
				const distance = XOR(peer.nodeId, targetId);

				if (closestDistance === null || distance < closestDistance) {
					closestDistance = distance;
					closestNode = peer;
				}
			}
		}

		return closestNode;
	};

	public findNode(key: number, count: number = BIT_SIZE): Peer[] {
		const closestNodes: CloseNodes[] = [];
		const bucketIndex = this.getBucketIndex(key);

		this.addNodes(key, bucketIndex, closestNodes);

		let aboveIndex = bucketIndex + 1;
		let belowIndex = bucketIndex - 1;

		while (closestNodes.length < count && (aboveIndex < HASH_SIZE || belowIndex >= 0)) {
			if (aboveIndex < HASH_SIZE && this.buckets.has(aboveIndex)) {
				this.addNodes(key, aboveIndex, closestNodes);
				aboveIndex++;
			} else {
				aboveIndex++;
			}

			if (belowIndex >= 0 && this.buckets.has(belowIndex)) {
				this.addNodes(key, belowIndex, closestNodes);
				belowIndex--;
			} else {
				belowIndex--;
			}
		}

		closestNodes.sort((a, b) => b.distance - a.distance).slice(0, count);
		return closestNodes.map((c) => c.node);
	}

	private addNodes(key: number, bucketIndex: number, closestNodes: CloseNodes[]) {
		const bucket = this.buckets.get(bucketIndex);
		if (!bucket) return;

		for (const node of bucket.getNodes()) {
			if (node.nodeId === key) continue;
			if (closestNodes.length === BIT_SIZE) break;

			closestNodes.push({
				distance: XOR(node.nodeId, key),
				node,
			});
		}
	}

	public getBucketIndex = (targetId: number): number => {
		const xorResult = this.tableId ^ targetId;

		for (let i = BIT_SIZE - 1; i >= 0; i--) {
			if (xorResult & (1 << i)) return i;
		}
		return BIT_SIZE - 1;
	};

	public nodeStore = <T extends MessagePayload<UDPDataInfo>>(key: string, value: string) => {
		this.store.set(Number(key), value);
	};

	public findValue = async (key: string): Promise<string | Peer[]> => {
		if (this.store.has(Number(key.toString()))) {
			return this.store.get(Number(key.toString()));
		}

		return this.findNode(Number(key), ALPHA);
	};
}

export default RoutingTable;
