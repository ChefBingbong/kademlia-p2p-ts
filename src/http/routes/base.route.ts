import { Router } from "express";
import KademliaNode from "../../node/node";
import BaseController from "../controller/base.controller";
import type { Routes } from "../interfaces/routes.interface";

class BaseRoute implements Routes {
  public router: Router = Router();
  public baseController: BaseController;
  public readonly path = "/";

  constructor(node: KademliaNode) {
    this.baseController = new BaseController(node);
    this.initializeRoutes();
  }

  private initializeRoutes(): void {
    this.router.get(`${this.path}getBucketNodes/:port`, this.baseController.getNodeBuckets);
    this.router.get(`${this.path}ping`, this.baseController.ping);
    this.router.get(`${this.path}getNodeMessages`, this.baseController.getNodeMessages);
    this.router.get(`${this.path}getNodeUdpMessages`, this.baseController.getNodeUDPMessages);
    this.router.get(`${this.path}findClosestNode/:id`, this.baseController.findClosestNode);

    this.router.post(`${this.path}postDirectMessage`, this.baseController.postDirectMessage);
    this.router.post(`${this.path}postBroadcast`, this.baseController.postBroadcast);
  }
}

export default BaseRoute;
