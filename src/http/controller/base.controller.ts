import { NextFunction, Request, Response } from "express";
import KademliaNode from "../../node/node";

class BaseController {
  public node: KademliaNode;

  constructor(node: KademliaNode) {
    this.node = node;
  }
  public ping = async (req: Request, res: Response, next: NextFunction) => {
    const payload = req.body;
    // this.node.init();
    return res.json({ message: "success" });
  };

  public getNodeBuckets = async (req: Request, res: Response, next: NextFunction) => {
    const buckets = this.node.table.getAllBuckets();
    return res.json({ message: this.node.table.getAllBuckets() });
  };

  public postDirectMessage = (req: Request, res: Response, next: NextFunction) => {
    try {
      this.node.sendDirect(req.body.id, {
        type: "direct-message",
        message: `recieved message from node ${this.node.port}`,
      });
      res.send("success");
    } catch (error) {
      next(error);
    }
  };

  public postBroadcast = (req: Request, res: Response, next: NextFunction) => {
    try {
      this.node.broadcast({
        type: "broadcast-message",
        message: `recieved message from node ${this.node.port}`,
        // nodeId: config.p2pPort,
      });
      res.send("success");
    } catch (error) {
      next(error);
    }
  };

  public getNodeMessages = (req: Request, res: Response, next: NextFunction) => {
    try {
      const messages = Array.from(this.node.messages.values());
      return res.json({ result: messages });
    } catch (error) {
      next(error);
    }
  };

  public findClosestNode = (req: Request, res: Response, next: NextFunction) => {
    try {
      console.log(req.params.id);
      const closest = this.node.table.findClosestNode(Number(req.params.id));
      return res.json({ result: closest });
    } catch (error) {
      next(error);
    }
  };
}

export default BaseController;
