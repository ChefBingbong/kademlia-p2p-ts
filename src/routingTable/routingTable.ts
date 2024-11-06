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

	public removeBucket = (peer: Peer) => {
		const bucketIndex = this.getBucketIndex(peer.nodeId);
		this.buckets.delete(bucketIndex);
	};

	public containsBucket = (peer: Peer) => {
		const bucketIndex = this.getBucketIndex(peer.nodeId);
		this.buckets.has(bucketIndex);
	};

	public getAllBuckets = () => {
		let bucketsJson: { [key: number]: typeof KBucket.prototype.toJSON.prototype } = {};
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

		const canIterateAbove = () => {
			return aboveIndex !== HASH_SIZE; // 159
		};

		const canIterateBelow = () => {
			return belowIndex >= 0;
		};

		while (true) {
			if (closestNodes.length === count || (!canIterateBelow() && !canIterateAbove())) {
				break;
			}

			while (canIterateAbove()) {
				if (this.buckets.has(aboveIndex)) {
					this.addNodes(key, aboveIndex, closestNodes);
					aboveIndex++;
					break;
				}
				aboveIndex++;
			}

			while (canIterateBelow()) {
				if (this.buckets.has(belowIndex)) {
					this.addNodes(key, belowIndex, closestNodes);
					belowIndex--;
					break;
				}
				belowIndex--;
			}
		}

		closestNodes.sort((a, b) => a.distance - b.distance);
		// const trimmedNodes = this.reduceNodes(closestNodes, BIT_SIZE);
		return closestNodes.map((c) => c.node);
	}
	private reduceNodes(nodes: CloseNodes[], size: number): CloseNodes[] {
		if (nodes.length > size) {
			nodes.splice(size);
		}
		return nodes;
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
