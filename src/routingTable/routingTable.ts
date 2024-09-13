import { KBucket } from "../kBucket/kBucket";
import { BIT_SIZE, HASH_SIZE } from "../node/constants";
import KademliaNode from "../node/node";
import { XOR } from "../node/utils";

type CloseNodes = {
  distance: number;
  node: number;
};

class RoutingTable {
  public tableId: number;
  buckets: Map<number, KBucket>;
  public node: KademliaNode;

  constructor(tableId: number, node: KademliaNode) {
    this.tableId = tableId;
    this.buckets = new Map();
    this.node = node;
  }

  public findBucket = (nodeId: number) => {
    const bucketIndex = this.getBucketIndex(nodeId);
    const bucket = this.buckets.get(bucketIndex);

    if (!bucket) {
      const newBucket = new KBucket(bucketIndex, this.tableId);
      this.buckets.set(bucketIndex, newBucket);
      return newBucket;
    }
    return bucket;
  };

  public async updateTables(contact: number | Array<number>) {
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
      for (const nodeId of nodes.nodes) {
        const distance = XOR(nodeId, targetId);
        console.log(distance);
        if (closestDistance === null || distance < closestDistance) {
          closestDistance = distance;
          closestNode = nodeId;
        }
      }
    }

    return closestNode;
  };

  public findNode(key: number, count: number = BIT_SIZE): number[] {
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

    closestNodes.sort((a, b) => b.distance - a.distance);
    const trimmedNodes = this.reduceNodes(closestNodes, BIT_SIZE);
    return trimmedNodes.map((c) => c.node);
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
      if (node === key || closestNodes.length >= BIT_SIZE) continue;

      closestNodes.push({
        distance: XOR(node, key),
        node,
      });
    }
  }

  public getBucketIndex = (targetId: number): number => {
    const xorResult = this.tableId ^ targetId;

    for (let i = BIT_SIZE - 1; i >= 0; i--) {
      if (xorResult & (1 << i)) return i;
    }
    return 0;
  };
}

export default RoutingTable;
