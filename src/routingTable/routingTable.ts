import dgram from "dgram";
import { KBucket } from "../kBucket/kBucket";
import { Message, MessagePayload, UDPDataInfo } from "../message/message";
import { BIT_SIZE, HASH_SIZE } from "../node/constants";
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

	private readonly store: Map<string, number[]>;

	constructor(tableId: number, node: KademliaNode) {
		this.tableId = tableId;
		this.buckets = new Map();
		this.node = node;
		this.store = new Map();
	}

	public getAllPeers = () => {
		const peers: Peer[] = [];
		for (const [_, nodes] of this.buckets.entries()) {
			for (const nodeId of nodes.nodes) {
				peers.push(nodeId);
			}
		}
		return peers;
	};

	public findBucket = (node: Peer) => {
		const bucketIndex = this.getBucketIndex(node.nodeId);
		const bucket = this.buckets.get(bucketIndex);

		if (!bucket) {
			const newBucket = new KBucket(bucketIndex, this.tableId, this.node);
			this.buckets.set(bucketIndex, newBucket);
			return newBucket;
		}
		return bucket;
	};

	public async updateTables(contact: Peer | Array<Peer>) {
		const contacts = Array.isArray(contact) ? contact : [contact];
		const promises: Array<Promise<unknown>> = [];

		for (const c of contacts) {
			const bucket = this.findBucket(c);

			promises.push(bucket.updateBucketNode(c));
		}

		await Promise.all(contacts);
	}

	public removeBucket = (nodeId: number) => {
		const bucketIndex = this.getBucketIndex(nodeId);
		this.buckets.delete(bucketIndex);
	};

	public containsBucket = (nodeId: number) => {
		const bucketIndex = this.getBucketIndex(nodeId);
		this.buckets.has(bucketIndex);
	};

	public getAllBuckets = () => {
		let bucketsJson = {};
		for (const bucket of this.buckets.values()) {
			bucketsJson[bucket.bucketId] = bucket.toJSON();
		}
		return bucketsJson;
	};

	public findClosestNode = (targetId: number): number | null => {
		let closestNode: number | null = null;
		let closestDistance: number | null = null;

		for (const [_, nodes] of this.buckets.entries()) {
			for (const node of nodes.nodes) {
				const distance = XOR(node.nodeId, targetId);

				if (closestDistance === null || distance < closestDistance) {
					closestDistance = distance;
					closestNode = node.nodeId;
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

	public nodeStore = <T extends MessagePayload<UDPDataInfo>>(message: Message<T>, info: dgram.RemoteInfo) => {
		const { data } = message.data;
		this.store.set(
			data.resId,
			data.closestNodes.map((c) => c.nodeId),
		);
	};

	public findValue = async (key: string): Promise<Array<Peer> | number[]> => {
		if (this.store.has(key)) {
			return this.store.get(key);
		}

		return this.findNode(Number(key), BIT_SIZE);
	};
}

export default RoutingTable;
