import { Application } from "express";
import { App } from "../http/app";
import { BIT_SIZE, PORT_NUMBER } from "./constants";
import { NodeState } from "./types";
import { getIdealDistance } from "./utils";

class KademliaNode {
  public nodeId: number;
  public ipAddress: string = "localhost";
  public port: number;
  public buckets: number[] = [];
  public network: Map<number, number>;

  private NodeState: NodeState;
  private api: App;
  private app: Application;

  constructor(id: number, port: number) {
    this.nodeId = id;
    this.port = port;
    this.api = new App();
    this.app = this.api.app;
    this.network = new Map<number, number>();
    this.NodeState = NodeState.OffLine;
  }

  public init() {
    const node_id = this.nodeId;
    const IDEAL_DISTANCE = getIdealDistance();

    const k_bucket_without_ping: number[] = [];
    for (let i = 0; i < IDEAL_DISTANCE.length; i++) {
      const res = (node_id ^ IDEAL_DISTANCE[i]) as number;
      k_bucket_without_ping.push(res);
    }

    for (let i = 0; i < 2 ** BIT_SIZE; i++) {
      this.network.set(i, PORT_NUMBER + i);
    }

    return k_bucket_without_ping;
  }
}
