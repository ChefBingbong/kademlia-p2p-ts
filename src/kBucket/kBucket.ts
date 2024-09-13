import { BIT_SIZE } from "../node/constants";

export class KBucket {
  public bucketSize: number = BIT_SIZE;
  public parentNodeId: number;
  public bucketId: number;
  public nodes: number[];

  constructor(bucketId: number, parentNodeId: number) {
    this.bucketId = bucketId;
    this.parentNodeId = parentNodeId;
    this.nodes = [];
  }

  public getNodes(): Array<number> {
    return this.nodes;
  }

  public async updateBucketNode(nodeId: number) {
    const current = this.nodes.find((n) => n === nodeId);

    if (current) {
      this.moveToFront(current);
      return;
    }

    if (this.nodes.length < this.bucketSize) {
      if (!this.nodes.includes(nodeId)) {
        this.nodes.push(nodeId);
      }
      return;
    }

    this.nodes.shift();
  }

  public moveToFront(nodeId: number) {
    this.nodes = [nodeId, ...this.nodes.filter((n) => n !== nodeId)];
  }

  toJSON() {
    return {
      id: this.bucketId,
      nodeId: this.parentNodeId,
      nodes: this.nodes,
    };
  }
}
