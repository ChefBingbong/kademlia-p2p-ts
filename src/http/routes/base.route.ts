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
    this.router.post(`${this.path}ping/:port`, this.baseController.ping);
  }
}

export default BaseRoute;
