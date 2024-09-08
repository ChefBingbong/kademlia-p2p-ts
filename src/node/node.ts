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
  public address: string;
  public port: number;
  public nodeId: number;
  public table: RoutingTable;
  private socket: Socket;
  public api: App;
  private stopDiscovery = false;
  public contacted = new Map<string, number>();

  public shortlist: number[] = [];
  public currentClosestNode: number;
  public closestNodes: boolean[] = [];

  constructor(id: number, port: number) {
    this.nodeId = id;
    this.port = port;
    this.address = "127.0.0.1";

    this.table = new RoutingTable(this.nodeId, this);
    this.socket = dgram.createSocket("udp4");
    this.api = new App(this, this.port);

    this.socket.on("message", this.handleMessage);
    this.api.listen();
  }

  public async start() {
    try {
      this.socket.bind(this.port, () => {
        this.table.updateTable(0);
        this.startNodeDiscovery();
      });

      setTimeout(() => this.stopNodeDiscovery(), 16000);
    } catch (err) {
      console.log(err);
    }
  }

  public send = (contact: number, type: any, data: any) => {
    const message = JSON.stringify({
      type,
      data: data,
      fromNodeId: this.nodeId,
      fromPort: this.port,
    });

    this.socket.send(message, contact, this.address);
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
    this.closestNodes.push(hasCloserThanExist);
  };
  private async findNodes(key: number) {
    this.shortlist = this.table.findNode(key, 4);
    this.currentClosestNode = this.shortlist[0];

    this.contactNearestNodes();
    return Array.from(this.contacted.values());
  }

  private contactNearestNodes = () => {
    this.closestNodes = [];
    for (const contact of this.shortlist) {
      if (this.contacted.has(contact.toString())) {
        continue;
      }
      this.send(3000 + contact, "FIND_NODE", {});
    }
    if (!this.closestNodes.length) return;

    const isUpdatedClosest = this.closestNodes.some(Boolean);
    if (isUpdatedClosest && this.contacted.size < 4) {
      this.contactNearestNodes();
    }
  };

  private handleMessage = async (msg: Buffer, info: dgram.RemoteInfo) => {
    try {
      const message = JSON.parse(msg.toString());
      const externalContact = message.fromNodeId;
      this.table.updateTable(externalContact);

      switch (message.type) {
        case "REPLY": {
          console.log(message);
          break;
        }
        case "PING": {
          this.send(info.port, "REPLY", { buckets: this.table.getAllBuckets() });
          break;
        }
        case "FIND_NODE": {
          const closestNodes = this.table.findNode(externalContact);
          this.send(info.port, "REPLY_FIND_NODE", {
            buckets: this.table.getAllBuckets(),
            closestNodes,
          });
          break;
        }
        case "REPLY_FIND_NODE": {
          message.data.closestNodes.forEach((b) => {
            this.table.updateTable(b);
          });
          this.handnleFindNodeRequest(message.data.closestNodes, externalContact);
          break;
        }
        default:
          return;
      }
    } catch (error) {
      console.error(error);
    }
  };

  public close() {
    this.socket.removeAllListeners("message");
    this.socket.close();
  }

  private async discoverNodes(): Promise<void> {
    while (!this.stopDiscovery) {
      const closeNodes = await this.findNodes(this.nodeId);
      closeNodes.forEach((n) => this.table.updateTable(n));
      await this.sleep(4000);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  startNodeDiscovery(): void {
    this.stopDiscovery = false;
    this.discoverNodes();
  }

  stopNodeDiscovery(): void {
    this.stopDiscovery = true;
    console.log("Stopping node discovery");
  }
}

export default KademliaNode;
