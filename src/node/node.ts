import axios from "axios";
import express, { Request, Response } from "express";
import { BIT_SIZE, PORT_NUMBER } from "./constants";
import { FindNodeResponse, NodeState, PingResponse, SaveValueResponse } from "./types";
import { HASH_BIT_SIZE, getIdealDistance } from "./utils";

class KademliaNode {
  public nodeId: number;
  public ipAddress: string = "localhost";
  public port: number;
  public buckets: number[] = [];
  public network: Map<number, number>;

  private NodeState: NodeState;
  private map: Map<number, string>;
  //   private api: App;
  private app = express();

  constructor(id: number, port: number) {
    this.nodeId = id;
    this.port = port;
    //     this.api = new App(port);
    //     this.app = this.api.app;
    this.network = new Map<number, number>();
    this.map = new Map<number, string>();
    this.NodeState = NodeState.OffLine;
  }

  public async start() {
    this.NodeState = NodeState.Online;
    this.buckets = this.init();

    try {
      this.app.use(express.json());
      // this.app.use(cors());
      this.app.get("/", (req: Request, res: Response) => {
        return res.send(`Kademila Running on ${this.nodeId}`);
      });

      this.app.listen(this.port, this.ipAddress, () => {
        console.log(`Kademila Running on ${this.nodeId}`);
      });

      this.app.get("/ping", async (req: Request, res: Response) => {
        return res
          .json({
            status: true,
            buckets: this.buckets,
            msg: `Kademila Running on ${this.nodeId}`,
          })
          .status(200);
      });

      this.app.get("/getAllKeys", async (req: Request, res: Response) => {
        const values = this.GET_ALL();
        const ports = this.GET_ALL_PORTS();
        res.send({ values, ports });
      });

      this.app.get("/get/:key", async (req: Request, res: Response) => {
        const key = parseInt(req.params.key);
        const value = this.GET(key);
        if (value) {
          return res.send({ value, found: true });
        }
        return res.send({ found: false, value: null });
      });

      this.app.get("/pingServer/:port", async (req: Request, res: Response) => {
        try {
          const port = req.params.port as string;
          let result = await axios.get(`http://${this.ipAddress}:${port}/ping`);
          result = result.data.status;
          return res
            .json({
              status: result,
              msg: `PING FROM ${this.nodeId} TO PORT=${port}`,
            })
            .status(200);
        } catch (error) {
          res.send(error);
        }
      });

      this.app.get("/findNode/:nodeId", async (req: Request, res: Response) => {
        const nodeId = parseInt(req.params.nodeId);
        if (nodeId > 2 ** BIT_SIZE) {
          console.log(nodeId);
          return res.status(200).json({ found: false, error: "nodeId not found" });
        }

        const currBuckets = this.buckets;
        try {
          console.log(currBuckets, nodeId);
          const route: number[] = [];
          const result = await this.FIND_NODE(nodeId, currBuckets, route);
          return res.json(result);
        } catch (error) {
          console.error("Error finding node:", error);
          res.status(500).send({ error: "Internal server error" });
        }
      });

      this.app.get("/findValue/:key", async (req: Request, res: Response) => {
        const hashKey = this.hashKey(parseInt(req.params.key));
        const data = await this.FIND_VALUE(hashKey);

        if (data?.value && data?.node_id && data?.route) {
          return res.send({
            value: data?.value,
            foundAt: data?.node_id,
            route: data?.route,
          });
        }
        return res.send({ found: false });
      });

      this.app.get("/save/:key/:value", async (req: Request, res: Response) => {
        try {
          const key = this.hashKey(parseInt(req.params.key));
          const value = req.params.value as string;

          if (key === this.nodeId) {
            this.map.set(key, value);
            return res.send({
              status: "SAVED",
              msg: `saved at node id ${this.nodeId}:${this.port}`,
            });
          }
          const port = this.network.get(key);
          await axios.get(`http://${this.ipAddress}:${port}/save/${key}/${value}`);

          console.log(`FORWARD at node id ${this.nodeId}:${port}`);
          return res.send({
            status: "FORWARD",
            msg: `FORWARD at node id ${this.nodeId}`,
          });
        } catch (error) {
          res.send({ error });
        }
      });
    } catch (error) {
      this.NodeState = NodeState.OffLine;
      console.log(error);
    }
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

  private SAVE(key: number, value: string) {
    this.map.set(key, value);
  }

  private hashKey(key: number): number {
    return HASH_BIT_SIZE(key);
  }

  public stop() {
    this.NodeState = NodeState.OffLine;
    // ? need stop the express server
  }

  private GET(key: number) {
    return this.map.get(key);
  }

  private GET_ALL(): string[] {
    const values: string[] = [];
    this.map.forEach((value) => {
      values.push(value);
    });
    return values;
  }

  private GET_ALL_PORTS(): number[] {
    const values: number[] = [];
    this.network.forEach((value) => {
      values.push(value);
    });
    return values;
  }

  private async PING_EXTERNAL(node_id: number) {
    const network_port = this.network.get(node_id);
    const result = await axios.get(`http://${this.ipAddress}:${network_port}/ping`);
    return (result.data as PingResponse).buckets;
  }

  public async FIND_VALUE(key: number): Promise<{
    value: string;
    node_id: number;
    route: number[];
  } | null> {
    const hash_key = this.hashKey(key);

    const new_route: number[] = [];

    if (hash_key === this.nodeId) {
      const value = this.map.get(hash_key);
      if (value) {
        return Promise.resolve({ value, node_id: this.nodeId, route: new_route });
      }
    }

    const { nodeId, route } = await this.FIND_NODE(hash_key, this.buckets, new_route);

    const wanted_port = this.network.get(nodeId!);

    const result = (await axios.get(`http://${this.ipAddress}:${wanted_port}/get/${hash_key}`))
      .data as SaveValueResponse;
    if (result.found) {
      return Promise.resolve({
        value: result.value!,
        node_id: nodeId!,
        route: route!,
      });
    }
    return null;
  }

  public async FIND_NODE(nodeId: number, buckets: number[], route: number[]): Promise<FindNodeResponse> {
    for (const bucketNode of buckets) {
      if (bucketNode === nodeId) {
        return { found: true, nodeId: bucketNode, route };
      }
    }

    let closestNode = -1;
    let minXorDistance = Infinity;

    for (const bucketNode of buckets) {
      const xorDistance = nodeId ^ bucketNode;
      if (xorDistance < minXorDistance) {
        minXorDistance = xorDistance;
        closestNode = bucketNode;
      }
    }

    if (closestNode !== -1) {
      try {
        const externalBuckets = await this.PING_EXTERNAL(closestNode);
        console.log(`Ping External Services node ${closestNode}`);
        route.push(closestNode);
        return await this.FIND_NODE(nodeId, externalBuckets, route);
      } catch (error) {
        console.error(`Error pinging external node ${closestNode}:`, error);
        return {
          found: false,
          error: "External node communication error",
          route,
        };
      }
    }

    return { found: false, error: "Node not found in k-buckets", route };
  }
}

export default KademliaNode;
