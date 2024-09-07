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
        this.send(3000, "PING", { nodeId: this.nodeId, port: this.port });
      });
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

  private handleRPC = async (msg: Buffer, info: dgram.RemoteInfo) => {
    try {
      const message = JSON.parse(msg.toString());
      const externalContact = message.fromNodeId;
      this.table.updateTable(externalContact);

      // console.log(message, info);
      switch (message.type) {
        case "REPLY": {
          console.log(message);
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
        default:
          // TODO: log, throw exception
          return;
      }
    } catch (error) {
      console.error(error);
    }
    console.log(this.table.getAllBuckets());
  };

  public close() {
    this.socket.removeAllListeners("message");
    this.socket.close();
  }
}

export default KademliaNode;
