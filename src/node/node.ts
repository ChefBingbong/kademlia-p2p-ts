import * as dgram from "dgram";
import { Socket } from "dgram";
import { App } from "../http/app";
import RoutingTable from "../routingTable/routingTable";
// import { Neighbours } from "../contacts/contacts";
// import { IContact } from "../contacts/types";
import { BIT_SIZE } from "./constants";

type NodeID = string; // Node ID as a string, typically represented as a hexadecimal string
type Contact = { nodeId: NodeID; ip: string; port: number };

export function getIdealDistance() {
  const IDEAL_DISTANCE: number[] = [];
  for (let i = 0; i < BIT_SIZE; i++) {
    const val = 2 ** i;
    IDEAL_DISTANCE.push(val);
  }
  return IDEAL_DISTANCE;
}
class KademliaNode {
  public peers: Map<number, number>;
  public address: string;
  public port: number;
  public nodeId: number;
  public table: RoutingTable;
  private socket: Socket;
  public api: App;

  public contacted = new Map<string, number>();
  public failed = new Set<string>();
  public shortlist: number[] = [];
  public currentClosestNode: number;
  public promises: boolean[] = [];

  constructor(id: number, port: number) {
    this.nodeId = id;
    this.port = port;
    this.address = "127.0.0.1";
    this.table = new RoutingTable(this.nodeId, this);
    this.socket = dgram.createSocket("udp4");
    this.socket.on("message", this.handleRPC);
    this.api = new App(this, this.port);
    this.api.listen();
  }

  public async start() {
    try {
      this.socket.bind(this.port, async () => {
        this.table.updateTable(this.nodeId);
        this.table.updateTable(0);
        const res = await this.init();
        //   const res = await this.init();

        res.forEach((r) => this.table.updateTable(r));
        //   console.log(this.table.findNode(this.nodeId), "heyyyyyyyy");
        //   this.send(3000, "FIND_NODE", { nodeId: this.nodeId, port: this.port });
      });
    } catch (err) {
      console.log(err);
    }
  }

  public init = async () => {
    const n = await this.findNodes(this.nodeId);
    return n;
  };

  public send = (contact: number, type: any, data: any) => {
    const message = JSON.stringify({
      type,
      data: data,
      fromNodeId: this.nodeId,
      fromPort: this.port,
    });

    this.socket.send(message, contact, this.address);
  };

  private handleRPC = async (msg: Buffer, info: dgram.RemoteInfo) => {
    try {
      const message = JSON.parse(msg.toString());
      const externalContact = message.fromNodeId;
      this.table.updateTable(externalContact);

      // console.log(message, info);
      switch (message.type) {
        case "REPLY": {
          //     console.log(message);
          const externalBuckets = Object.values(message.data.buckets);
          let externalNodes = [];

          externalBuckets.forEach((b: { id: number; nodeId: number; nodes: number[] }) => {
            this.table.updateTable(b.nodeId);
            b.nodes.forEach((n) => {
              if (n !== 0 && n !== this.nodeId) externalNodes.push(n);
            });
          });

          if (message.data?.break === true) break;
          externalNodes.forEach((n) => {
            this.send(n + 3000, "REPLY", { buckets: this.table.getAllBuckets(), break: true });
          });
          break;
        }
        case "PING": {
          this.send(info.port, "REPLY", { buckets: this.table.getAllBuckets() });
          break;
        }
        case "FIND_NODE": {
          const closestNodes = this.table.findNode(externalContact);
          //     console.log(closestNodes, "hey");
          this.send(info.port, "REPLY_FIND_NODE", {
            buckets: this.table.getAllBuckets(),
            closestNodes,
            externalContact,
          });
          break;
        }
        case "REPLY_FIND_NODE": {
          message.data.closestNodes.forEach((b) => {
            this.table.updateTable(b);
          });
          this.handnleFindNodeRequest(message.data.closestNodes, message.data.externalContact);
          break;
        }
        default:
          // TODO: log, throw exception
          return;
      }
    } catch (error) {
      console.error(error);
    }
    //     console.log(this.table.getAllBuckets());
    //     console.log("heyyyyyyyy");
  };

  public handnleFindNodeRequest = (nodeResponse: number[], contact: number) => {
    let hasCloserThanExist = false;

    this.contacted.set(contact.toString(), contact);

    for (const closerNode of nodeResponse) {
      this.shortlist.push(closerNode);

      const currentDistance = this.table.getBucketIndex(this.currentClosestNode);
      const distance = this.table.getBucketIndex(closerNode);

      if (distance < currentDistance) {
        this.currentClosestNode = closerNode;
        hasCloserThanExist = true;
      }
    }
    this.promises.push(hasCloserThanExist);
  };
  private async findNodes(key: number) {
    this.shortlist = this.table.findNode(key, 4);
    this.currentClosestNode = this.shortlist[0];

    let iteration: number;
    const communicate = async () => {
      this.promises = [];

      iteration = iteration == null ? 0 : iteration + 1;
      const alphaContacts = this.shortlist.slice(iteration * 3, iteration * 3 + 3);
      // console.log(alphaContacts);
      for (const contact of alphaContacts) {
        if (this.contacted.has(contact.toString())) {
          continue;
        }
        this.send(3000 + contact, "FIND_NODE", { nodeId: this.nodeId, port: this.port });
      }

      // console.log(this.promises.length);
      if (!this.promises.length) {
        console.log("No more contacts in shortlist");
        return;
      }

      const isUpdatedClosest = this.promises.some(Boolean);

      if (isUpdatedClosest && this.contacted.size < 4) {
        await communicate();
      }
    };

    await communicate();

    return Array.from(this.contacted.values());
  }

  public close() {
    this.socket.removeAllListeners("message");
    this.socket.close();
  }
}

export default KademliaNode;
