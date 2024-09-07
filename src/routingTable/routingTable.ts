import { KBucket } from "../kBucket/kBucket";
import KademliaNode from "../node/node";

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

  public findClosest = () => {
    for (const bucket of this.buckets.values()) {
      let closestNodes = [];

      if (bucket.nodes.length >= 8) {
        closestNodes = bucket.nodes.slice(0, 8);
      }
      if (bucket.nodes.length > 0) {
        closestNodes = Array.of(8).map(() => bucket.nodes[0]);
        return closestNodes;
      }
    }
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

    //     try {
    //       const contact = Object.values(this.getAllBuckets())[0] as any;
    //       this.node.send(3000 + contact?.nodeId, "REPLY", { buckets: this.getAllBuckets(), break: true });
    //     } catch (e) {}
  }

  private getBucketIndex = (targetId: number): number => {
    const xorResult = this.tableId ^ targetId;

    for (let i = 3; i >= 0; i--) {
      if (xorResult & (1 << i)) return i;
    }
    return 0;
  };
}

export default RoutingTable;
