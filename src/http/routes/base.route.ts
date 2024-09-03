import { Router } from "express";
import BaseController from "../controller/base.controller";
import type { Routes } from "../interfaces/routes.interface";

class BaseRoute implements Routes {
  public router: Router = Router();
  public baseController: BaseController;
  public readonly path = "/";

  constructor() {
    this.baseController = new BaseController();
    this.initializeRoutes();
  }

  private initializeRoutes(): void {
    this.router.get(`${this.path}/ping`, this.baseController.ping);
    this.router.get(`${this.path}/pingServer/:port`, this.baseController.pingServer);
    this.router.get(`${this.path}/get/:key`, this.baseController.get);
    this.router.get(`${this.path}/getAllKeys`, this.baseController.getAllKeys);
    this.router.get(`${this.path}/findNode/:nodeId`, this.baseController.findNode);
    this.router.get(`${this.path}/findValue/:key`, this.baseController.findValue);
    this.router.get(`${this.path}/store/:key/:value`, this.baseController.store);
  }
}

export default BaseRoute;
