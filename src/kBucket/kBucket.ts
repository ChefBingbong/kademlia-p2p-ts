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

  public updateBucketNode(nodeId: number) {
    const current = this.nodes.find((n) => n === nodeId);

    if (current) {
      this.moveToEnd(current);
      return;
    }

    if (this.nodes.length < this.bucketSize) {
      this.nodes.push(nodeId);
      return;
    }
  }

  public moveToEnd(nodeId: number) {
    this.nodes = [...this.nodes.filter((n) => n !== nodeId), nodeId];
  }

  toJSON() {
    return {
      id: this.bucketId,
      nodeId: this.parentNodeId,
      nodes: this.nodes,
    };
  }
}
