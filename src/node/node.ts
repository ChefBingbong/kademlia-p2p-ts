import * as dgram from "dgram";
import { v4 } from "uuid";
import { Server, WebSocket } from "ws";
import { App } from "../http/app";
import { Message } from "../message/message";
import RoutingTable from "../routingTable/routingTable";
import WebSocketTransport from "../transports/tcp/wsTransport";
import UDPTransport from "../transports/udp/udpTransport";
import { ErrorWithCode, ProtocolError } from "../utils/errors";
import { BIT_SIZE } from "./constants";
// import { Neighbours } from "../contacts/contacts";
// import { IContact } from "../contacts/types";
import { Listener, P2PNetworkEventEmitter } from "./eventEmitter";

type NodeID = string; // Node ID as a string, typically represented as a hexadecimal string
type Contact = { nodeId: NodeID; ip: string; port: number };

class KademliaNode {
  public address: string;
  public port: number;
  public nodeId: number;
  public table: RoutingTable;
  public s = false;
  public api: App;
  private stopDiscovery = false;
  public contacted = new Map<string, number>();
  public seenMessages: Set<string> = new Set();
  public messages = new Map<string, string>();

  public readonly connections: Map<string, WebSocket>;
  private nodeResponses: Map<string, { resolve: Function; type: any }>;

  public shortlist: number[] = [];
  public currentClosestNode: number;
  public closestNodes: boolean[] = [];

  private readonly emitter: P2PNetworkEventEmitter;
  private udpTransport: UDPTransport;
  private wsTransport: WebSocketTransport;
  private server: Server;

  on: (event: string, listener: (...args: any[]) => void) => void;
  off: (event: string, listener: (...args: any[]) => void) => void;
  private isInitialized: boolean = false;

  constructor(id: number, port: number) {
    this.nodeId = id;
    this.port = port;
    this.address = "127.0.0.1";
    this.connections = new Map();
    this.nodeResponses = new Map();

    this.udpTransport = new UDPTransport(this.nodeId, this.port);
    // this.wsTransport = new WebSocketTransport(this.nodeId, this.port, []);

    this.emitter = new P2PNetworkEventEmitter(false);
    this.emitter.on.bind(this.emitter);
    this.emitter.off.bind(this.emitter);

    this.on = (e: string, l: Listener) => this.emitter.on(e, l);
    this.off = (e: string, l: Listener) => this.emitter.on(e, l);

    this.api = new App(this, this.port);
    this.table = new RoutingTable(this.nodeId, this);
    this.server = new WebSocket.Server({ port: this.port + 1000 });

    this.api.listen();
    this.initState();
  }

  public async start() {
    await this.table.updateTables(0);
    this.startNodeDiscovery();
  }

  // server init
  private initState(): void {
    this.emitter.on("_connect", (connectionId) => {
      this._send(connectionId.connectionId, {
        type: "handshake",
        data: { nodeId: connectionId },
      });
    });

    this.emitter.on("_disconnect", (connectionId) => {
      this.emitter.emitDisconnect(connectionId, true);
    });

    this.emitter.on("_message", async ({ connectionId, message }) => {
      const { type, data } = message;
      if (type === "handshake") {
        const { nodeId } = data;
        this.emitter.emitConnect(nodeId, true);
      }

      if (type === "message") {
        this.emitter.emitMessage(connectionId, data, true);
      }
    });

    this.emitter.on("message", ({ nodeId, data: packet }) => {
      if (this.seenMessages.has(packet.id) || packet.ttl < 1) return;

      console.log(`node ${nodeId} is broadcasting to ${this.shortlist} ${this.nodeId}`);

      const message = JSON.stringify({ id: packet.id, msg: packet.message.message });
      this.messages.set(packet.id, message);

      if (packet.type === "broadcast") {
        if (packet.origin === this.port.toString()) {
          this.emitter.emitBroadcast(packet.message, packet.origin);
        } else {
          this.broadcast(packet.message, packet.id, packet.origin);
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

  public listen(): (cb?: any) => void {
    if (!this.isInitialized)
      throw new ErrorWithCode(`Cannot listen before server is initialized`, ProtocolError.PARAMETER_ERROR);

    this.server.on("connection", (socket) => {
      this.handleNewSocket(socket, this.nodeId);
    });

    this.handlePeerConnection();
    this.handlePeerDisconnect();

    this.handleBroadcastMessage();
    this.handleDirectMessage();

    this.udpTransport.onMessage(this.handleMessage);

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

  private handlePeerConnection = (callback?: () => Promise<void>) => {
    this.on("connect", async ({ nodeId }: { nodeId: { connectionId: string } }) => {
      console.log(`Node ${this.nodeId} connected to: ${nodeId.connectionId}`);
      // await callback();
    });
  };

  private handlePeerDisconnect = (callback?: () => Promise<void>) => {
    this.on("disconnect", async ({ nodeId }: { nodeId: string }) => {
      console.log(`Node disconnected: ${nodeId}`);
      // await callback();
    });
  };

  public udpMessageResolver = (params: any, resolve: (value?: unknown) => void, reject: (reason?: any) => void) => {
    const { type, responseId } = params;
    if (type === "REPLY") resolve();
    this.emitter.once(`response_${responseId}`, (data: any) => {
      if (data.error) {
        return reject(data.error);
      }
      resolve(data.closestNodes);
    });
  };

  private handleFindNodeQuery = async (
    closeNodesResponse: Promise<number[]>,
    nodeId: number,
    contactedNodes: Map<string, number>,
    nodeShortlist: number[],
    initialClosestNode: number,
  ) => {
    let hasCloserThanExist = false;

    try {
      const closeNodes = await closeNodesResponse;
      contactedNodes.set(nodeId.toString(), nodeId);

      for (const currentCloseNode of closeNodes) {
        nodeShortlist.push(currentCloseNode);

        const currentDistance = this.table.getBucketIndex(initialClosestNode);
        const distance = this.table.getBucketIndex(currentCloseNode);

        if (distance < currentDistance) {
          initialClosestNode = currentCloseNode;
          hasCloserThanExist = true;
        }
      }
    } catch (e) {
      console.error(e);
    }

    return hasCloserThanExist;
  };

  private findNodeRecursiveSearch = async (
    contactedNodes: Map<string, number>,
    nodeShortlist: number[],
    initialClosestNode: number,
  ) => {
    const findNodePromises: Array<Promise<boolean>> = [];

    for (const node of nodeShortlist) {
      if (contactedNodes.has(node.toString())) {
        continue;
      }
      const findNodeResponse = this.udpTransport.sendMessage(
        3000 + node,
        "FIND_NODE",
        {},
        undefined,
        this.udpMessageResolver,
      );
      findNodePromises.push(
        this.handleFindNodeQuery(findNodeResponse, node, contactedNodes, nodeShortlist, initialClosestNode),
      );
    }

    if (!findNodePromises.length) {
      console.log("No more contacts in shortlist");
      return;
    }

    const results = await Promise.all(findNodePromises);
    const isUpdatedClosest = results.some(Boolean);

    if (isUpdatedClosest && contactedNodes.size < BIT_SIZE) {
      await this.findNodeRecursiveSearch(contactedNodes, nodeShortlist, initialClosestNode);
    }
  };
  private findNodes = async (key: number) => {
    const contacted = new Map<string, any>();
    const shortlist = this.table.findNode(key);

    let currentClosestNode = shortlist[0];
    await this.findNodeRecursiveSearch(contacted, shortlist, currentClosestNode);

    return Array.from(contacted.values());
  };

  private handleMessage = async (msg: Buffer, info: dgram.RemoteInfo) => {
    try {
      const message = JSON.parse(msg.toString());
      const externalContact = message.fromNodeId;
      await this.table.updateTables(externalContact);

      switch (message.type) {
        case "REPLY": {
          // console.log(message);
          if (message?.data?.closestNodes) {
            await this.table.updateTables(message.data.closestNodes);

            this.emitter.emit(`response_${message.resId}`, {
              closestNodes: message?.data?.closestNodes,
              error: null,
            });
          }
          break;
        }
        case "FIND_NODE": {
          const closestNodes = this.table.findNode(externalContact);
          await this.udpTransport.sendMessage(
            info.port,
            "REPLY",
            { closestNodes },
            message.resId,
            this.udpMessageResolver,
          );
          break;
        }

        default:
          return;
      }
    } catch (error) {
      console.error(error);
    }
  };

  private async discoverNodes(): Promise<void> {
    while (!this.stopDiscovery) {
      // this.s = true
      const closeNodes = await this.findNodes(this.nodeId);
      if (!this.s) await this.table.updateTables(closeNodes);
      this.s = true;

      closeNodes.forEach((n) => {
        if (!this.connections.has(n.toString())) {
          this.connect(n + 4000, () => {
            console.log(`Connection to ${n + 4000} established.`);
          });
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
      for (const $nodeId of this.connections.keys()) {
        this.sendTCP($nodeId, packet);
        this.seenMessages.add(packet.id);
      }
    }
  };

  private sendTCP = (nodeId: string, data: any) => {
    this._send(nodeId, { type: "message", data });
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
      // TO-DO
      await callback();
    });
  };

  private handleDirectMessage = (callback?: () => Promise<void>) => {
    this.on("direct", async ({ message }: { message: any }) => {
      try {
        // TO-DO
        await callback();
      } catch (error) {
        console.log(error);
        throw new ErrorWithCode(`Error prcessing direct message for ${this.nodeId}`, ProtocolError.INTERNAL_ERROR);
      }
    });
  };

  protected createDirectMessage = (round: any, messageType: any[], currentRound: number): Message<any>[] => {
    if (!round.isDirectMessageRound) return [];

    return messageType.map((msg) => {
      return Message.create<any>(this.selfId, msg?.to, this.session.protocolId, currentRound, msg, false);
    });
  };

  protected createBroadcastMessage = (round: any, messageType: any, currentRound: number): Message<any> | undefined => {
    if (!round.isBroadcastRound) return undefined;
    return Message.create<any>(this.selfId, "", this.session.protocolId, currentRound, messageType, true);
  };

  protected storePeerDirectMessageResponse(newDirectMessage: Msg<any>, round: any, currentRound: number) {
    if (
      round.isDirectMessageRound &&
      newDirectMessage &&
      this.validator.canAccept(newDirectMessage, this.session, this.selfId)
    ) {
      this.directMessages.set(currentRound, newDirectMessage.Data);
    }
    return this.directMessages.getNonNullValuesLength(currentRound);
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
