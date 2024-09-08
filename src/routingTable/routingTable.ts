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

  public updateTable(nodeId: number) {
    const bucket = this.findBucket(nodeId);

    if (bucket?.nodes.includes(nodeId)) {
      bucket.moveToEnd(bucket.bucketId);
      return;
    }

    if (bucket?.nodes.length < bucket?.bucketSize) {
      bucket.nodes.push(nodeId);
      return;
    }
  }

  public findNode(key: number, count: number = 6) {
    const closestNodes: CloseNodes[] = [];

    const bucketIndex = this.getBucketIndex(key);
    this.addNodes(key, bucketIndex, closestNodes);

    let aboveIndex = bucketIndex + 1;
    let belowIndex = bucketIndex - 1;
    while (true) {
      if (closestNodes.length === count || (!(belowIndex > 0) && !(aboveIndex !== HASH_SIZE))) {
        break;
      }

      while (aboveIndex !== HASH_SIZE) {
        if (this.buckets.has(aboveIndex)) {
          this.addNodes(key, aboveIndex, closestNodes);
          aboveIndex++;
          break;
        }
        aboveIndex++;
      }

      while (belowIndex > 0) {
        if (this.buckets.has(belowIndex)) {
          this.addNodes(key, belowIndex, closestNodes);
          belowIndex--;
          break;
        }
        belowIndex--;
      }
    }

    const r = closestNodes.map((c) => c.node);
    return r.sort((a, b) => b - a);
  }

  private addNodes = (key: number, bucketIndex: number, nodes: CloseNodes[]) => {
    const bucket = this.buckets.get(bucketIndex);
    if (!bucket) return;

    for (const node of bucket.getNodes()) {
      if (node === key) continue;
      if (nodes.length === BIT_SIZE) break;

      nodes.push({ distance: XOR(node, key), node });
    }
  };

  public getBucketIndex = (targetId: number): number => {
    const xorResult = this.tableId ^ targetId;

    for (let i = 3; i >= 0; i--) {
      if (xorResult & (1 << i)) return i;
    }
    return 0;
  };
}

export default RoutingTable;
