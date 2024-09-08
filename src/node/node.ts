import * as dgram from "dgram";
import { Socket } from "dgram";
import { v4 } from "uuid";
import { Server, WebSocket } from "ws";
import { App } from "../http/app";
import RoutingTable from "../routingTable/routingTable";
import { ErrorWithCode, ProtocolError } from "../utils/errors";
// import { Neighbours } from "../contacts/contacts";
// import { IContact } from "../contacts/types";
import { BIT_SIZE } from "./constants";
import { Listener, P2PNetworkEventEmitter } from "./eventEmitter";

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
  private seenMessages: Set<string> = new Set();

  public readonly connections: Map<string, WebSocket>;
  //   public readonly neighbors: Map<string, string>;

  public readonly neighbors: Map<string, string>;
  public shortlist: number[] = [];
  public currentClosestNode: number;
  public closestNodes: boolean[] = [];

  private readonly emitter: P2PNetworkEventEmitter;
  private server: Server;

  on: (event: string, listener: (...args: any[]) => void) => void;
  off: (event: string, listener: (...args: any[]) => void) => void;
  private isInitialized: boolean = false;

  constructor(id: number, port: number) {
    this.nodeId = id;
    this.port = port;
    this.address = "127.0.0.1";
    this.connections = new Map();
    this.neighbors = new Map();
    this.table = new RoutingTable(this.nodeId, this);
    this.socket = dgram.createSocket("udp4");
    this.api = new App(this, this.port);

    this.emitter = new P2PNetworkEventEmitter(false);
    this.emitter.on.bind(this.emitter);
    this.emitter.off.bind(this.emitter);
    this.on = (e: string, l: Listener) => this.emitter.on(e, l);
    this.off = (e: string, l: Listener) => this.emitter.on(e, l);

    this.server = new WebSocket.Server({ port: this.port + 1000 });

    this.socket.on("message", this.handleMessage);
    this.api.listen();

    this.initState();
  }

  public async start() {
    try {
      this.socket.bind(this.port, () => {
        this.table.updateTable(0);
        this.startNodeDiscovery();
      });

      // setTimeout(() => this.stopNodeDiscovery(), 20000);
    } catch (err) {
      console.log(err);
    }
  }

  // server init
  private initState(): void {
    this.emitter.on("_connect", (connectionId) => {
      console.log("connectingggg", connectionId);
      // this.neighbors.set(connectionId, connectionId);
    });

    this.emitter.on("_disconnect", (connectionId) => {
      console.log("disconnecting");
      // this.emitter.emitDisconnect(nodeId, true);
    });

    this.emitter.on("_message", async ({ connectionId, message }) => {
      const { type, data } = message;

      if (type === "message") {
        this.emitter.emitMessage(connectionId, data, true);
      }
    });

    this.emitter.on("message", ({ nodeId, data: packet }) => {
      if (this.seenMessages.has(packet.id) || packet.ttl < 1) return;

      if (packet.type === "broadcast") {
        if (packet.origin !== this.port) {
          this.emitter.emitBroadcast(packet.message, packet.origin);
        } else {
          this.broadcast(packet.message, packet.id, packet.origin, packet.ttl - 1);
        }
      }

      if (packet.type === "direct") {
        if (packet.destination === this.port) {
          this.emitter.emitDirect(packet.message, packet.origin);
        } else {
          this.sendDirect(packet.destination, packet.message, packet.id, packet.origin, packet.ttl - 1);
        }
      }
    });

    this.isInitialized = true;
    this.listen();
  }

  public listen(cb?: () => void): (cb?: any) => void {
    if (!this.isInitialized)
      throw new ErrorWithCode(`Cannot listen before server is initialized`, ProtocolError.PARAMETER_ERROR);

    this.server.on("connection", (socket) => {
      this.handleNewSocket(socket, this.nodeId);
    });

    this.handlePeerConnection(async (p: number) => {});
    this.handlePeerDisconnect(async (p: number) => {});

    this.handleBroadcastMessage(async () => {});
    this.handleDirectMessage(async () => {});

    this.connect(this.port + 1000, () => {
      console.log(`Connection to ${this.port + 1000} established.`);
    });
    return (cb) => this.server.close(cb);
  }

  private handleNewSocket = (socket: WebSocket, nodeId: number, emitConnect = true) => {
    const connectionId = nodeId.toString();
    this.connections.set(connectionId, socket);
    if (emitConnect) this.emitter.emitConnect(this.nodeId.toString(), false);

    socket.on("message", (message: any) => {
      console.log(message);
      const receivedData = JSON.parse(message);
      this.emitter.emitMessage(connectionId, receivedData, false);
    });

    socket.on("close", () => {
      this.connections.delete(connectionId);
      this.emitter.emitDisconnect(connectionId, false);
    });

    socket.on("error", (err) => {
      console.error(`Socket connection error: ${err.message}`);
    });
  };

  // connect and listen logic
  public connect = (port: number, cb?: () => void) => {
    const socket = new WebSocket(`ws://localhost:${port}`);

    socket.on("error", (err) => {
      console.error(`Socket connection error: ${err.message}`);
    });

    socket.on("open", async () => {
      this.handleNewSocket(socket, port - 4000);
      cb?.();
    });

    return () => socket.terminate();
  };

  // event handler logic
  private handlePeerConnection = (callback?: (p: number, type: string) => Promise<void>) => {
    this.on("connect", async ({ nodeId }: { nodeId: string }) => {
      console.log(`New node connected: ${nodeId}`);
    });
  };

  private handlePeerDisconnect = (callback?: (p: number, type: string) => Promise<void>) => {
    this.on("disconnect", async ({ nodeId }: { nodeId: string }) => {
      console.log(`Node disconnected: ${nodeId}`);
    });
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
      // console.log(closeNodes);
      closeNodes.forEach((n) => {
        this.table.updateTable(n);

        if (!this.connections.has(n.toString())) {
          this.connect(n + 4000, () => {
            console.log(`Connection to ${n + 4000} established.`);
          });
        } else {
          const socket = this.connections.get(n.toString());

          if (socket) socket.send(JSON.stringify({ message: "heyyy" }));
        }
      });

      await this.sleep(5000);
    }
  }

  public broadcast = (message: any, id: string = v4(), origin: string = this.port.toString(), ttl: number = 255) => {
    this.sendPacket({ id, ttl, type: "broadcast", message, origin });
  };

  public sendDirect = (
    destination: string,
    message: any,
    id: string = v4(),
    origin: string = this.port.toString(),
    ttl: number = 255,
  ) => {
    this.sendPacket({
      id,
      ttl,
      type: "direct",
      message,
      destination,
      origin,
    });
  };

  private sendPacket = (packet: any) => {
    if (packet.type === "direct") {
      this.sendTCP(packet.destination, packet);
      this.seenMessages.add(packet.id);
    } else {
      for (const $nodeId of this.neighbors.keys()) {
        this.sendTCP($nodeId, packet);
        // this.seenMessages.add(packet.id);
      }
    }
  };

  private sendTCP = (nodeId: string, data: any) => {
    const connectionId = this.neighbors.get(nodeId);
    this._send(connectionId, { type: "message", data });
  };

  private _send = (connectionId: string, message: any) => {
    const socket = this.connections.get(connectionId);

    if (!socket)
      throw new ErrorWithCode(
        `Attempt to send data to connection that does not exist ${connectionId}`,
        ProtocolError.INTERNAL_ERROR,
      );
    socket.send(JSON.stringify(message));
  };

  private handleBroadcastMessage = (callback?: () => Promise<void>) => {
    this.on("broadcast", async ({ message }: { message: any }) => {
      await callback();
    });
  };

  private handleDirectMessage = (callback?: () => Promise<void>) => {
    this.on("direct", async ({ message }: { message: any }) => {
      try {
        await callback();
      } catch (error) {
        console.log(error);
        throw new ErrorWithCode(`Error prcessing direct message for ${this.nodeId}`, ProtocolError.INTERNAL_ERROR);
      }
    });
  };

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
