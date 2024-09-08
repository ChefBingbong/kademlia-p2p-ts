import { NextResponse, Request, Response } from "express";
import KademliaNode from "../../node/node";

class BaseController {
  public node: KademliaNode;

  constructor(node: KademliaNode) {
    this.node = node;
  }
  public ping = async (req: Request, res: Response, next: NextResponse) => {
    const payload = req.body;
    this.node.init();
    return res.json({ message: "success" });
  };

  public getNodeBuckets = async (req: Request, res: Response, next: NextResponse) => {
    const buckets = this.node.table.getAllBuckets();
    return res.json({ message: this.node.table.getAllBuckets() });
  };
}

export default BaseController;
