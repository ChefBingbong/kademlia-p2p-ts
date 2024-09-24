import * as dgram from "dgram";
import { v4 } from "uuid";
import { Server, WebSocket } from "ws";
import { JobExecutor } from "../discoveryScheduler/discExecutor";
// import { Neighbours } from "../contacts/contacts";
// import { IContact } from "../contacts/types";
import { DiscoveryScheduler, SchedulerInfo } from "../discoveryScheduler/discoveryScheduler";
import { App } from "../http/app";
import { Message, MessageNode, MessagePayload, UDPDataInfo } from "../message/message";
import { MessageType, Transports } from "../message/types";
import RoutingTable from "../routingTable/routingTable";
import WebSocketTransport from "../transports/tcp/wsTransport";
import UDPTransport from "../transports/udp/udpTransport";
import { ErrorWithCode, ProtocolError } from "../utils/errors";
import { extractError } from "../utils/extractError";
import { BIT_SIZE } from "./constants";
import { Listener, P2PNetworkEventEmitter } from "./eventEmitter";

type NodeID = string; // Node ID as a string, typically represented as a hexadecimal string
type Contact = { nodeId: NodeID; ip: string; port: number };

class KademliaNode {
  public address: string;
  public port: number;
  public nodeId: number;
  public readonly nodeContact: MessageNode & { ip: string };
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
  public discInitComplete: boolean;

  private readonly emitter: P2PNetworkEventEmitter;
  private udpTransport: UDPTransport;
  private wsTransport: WebSocketTransport;
  private server: Server;
  public discScheduler: DiscoveryScheduler;

  on: (event: string, listener: (...args: any[]) => void) => void;
  off: (event: string, listener: (...args: any[]) => void) => void;
  private isInitialized: boolean = false;

  constructor(id: number, port: number) {
    this.nodeId = id;
    this.port = port;
    this.address = "127.0.0.1";
    this.discInitComplete = false;
    this.nodeContact = {
      address: this.port.toString(),
      nodeId: this.nodeId,
      ip: this.address,
    };
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

    const jobId = "discScheduler";
    const schedule = "*/10 * * * * *";
    const timestamp = Date.now();
    const info: SchedulerInfo = { start: timestamp, chnageTime: timestamp + 20000 };
    this.discScheduler = new DiscoveryScheduler({ jobId, schedule, process, info });

    this.api.listen();
    this.initState();
  }

  public async start() {
    await this.table.updateTables(0);
    await this.initDiscScheduler();
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

  public async initDiscScheduler() {
    this.discScheduler.createSchedule(this.discScheduler.schedule, async () => {
      try {
        await JobExecutor.addToQueue(`${this.discScheduler.jobId}-${this.port}`, async () => {
          const timestamp = Date.now();

          if (timestamp > this.discScheduler.info.chnageTime && !this.discInitComplete) {
            this.discScheduler.setSchedule("*/5 * * * *");
            this.discScheduler.stopCronJob();
            this.discInitComplete = true;

            await this.initDiscScheduler();
            console.log(`${this.port} initialized new cron for next lottery start time ${timestamp}`);
          }

          const closeNodes = await this.findNodes(this.nodeId);
          await this.table.updateTables(closeNodes);

          for (const closestNode of closeNodes) {
            if (!this.connections.has(closestNode.toString())) {
              this.connect(closestNode + 4000, () => {
                console.log(`Connection to ${closestNode + 4000} established.`);
              });
            }
          }
          closeNodes.forEach((n: number) => {
            if (!this.connections.has(n.toString())) {
              this.connect(n + 4000, () => {
                console.log(`Connection to ${n + 4000} established.`);
              });
            }
          });
        });
      } catch (error) {
        console.error(`message: ${extractError(error)}, fn: executeCronTask`);
      }
    });
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

      const recipient = { address: (node + 3000).toString(), nodeId: node };

      const payload = this.buildMessagePayload<UDPDataInfo>(MessageType.PeerDiscovery, { resId: v4() }, this.nodeId);
      const message = this.createUdpMessage<UDPDataInfo>(recipient, MessageType.FindNode, payload);

      const findNodeResponse = this.udpTransport.sendMessage<MessagePayload<UDPDataInfo>>(
        message,
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
      const message = JSON.parse(msg.toString()) as Message<MessagePayload<UDPDataInfo>>;
      const externalContact = message.from.nodeId;
      await this.table.updateTables(externalContact);

      switch (message.type) {
        case "REPLY": {
          const closestNodes = message.data.data.closestNodes;
          const resId = message.data.data.resId;

          await this.table.updateTables(closestNodes);
          this.emitter.emit(`response_${resId}`, { closestNodes, error: null });
          break;
        }
        case "FIND_NODE": {
          const closestNodes = this.table.findNode(externalContact);
          const data = { resId: message.data.data.resId, closestNodes };
          const recipient = { address: message.from.address, nodeId: message.from.nodeId };

          const messagePayload = this.buildMessagePayload<UDPDataInfo>(
            MessageType.PeerDiscovery,
            data,
            externalContact,
          );
          const payload = this.createUdpMessage<UDPDataInfo>(recipient, MessageType.Reply, messagePayload);
          await this.udpTransport.sendMessage<MessagePayload<UDPDataInfo>>(payload, this.udpMessageResolver);
          break;
        }

        default:
          return;
      }
    } catch (error) {
      console.error(error);
    }
  };

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

  // protected createDirectMessage = (round: any, messageType: any[], currentRound: number): Message<any>[] => {
  //   if (!round.isDirectMessageRound) return [];

  //   return messageType.map((msg) => {
  //     return Message.create<any>(this.selfId, msg?.to, this.session.protocolId, currentRound, msg, false);
  //   });
  // };

  protected createUdpMessage = <T>(to: MessageNode, type: MessageType, data: MessagePayload<T>) => {
    const { address: toPort, nodeId: toNodeId } = to;
    return Message.create<MessagePayload<T>>(
      this.port.toString(),
      toPort,
      this.nodeId,
      toNodeId,
      Transports.Udp,
      data,
      type,
    );
  };

  // protected storePeerDirectMessageResponse(newDirectMessage: Msg<any>, round: any, currentRound: number) {
  //   if (
  //     round.isDirectMessageRound &&
  //     newDirectMessage &&
  //     this.validator.canAccept(newDirectMessage, this.session, this.selfId)
  //   ) {
  //     this.directMessages.set(currentRound, newDirectMessage.Data);
  //   }
  //   return this.directMessages.getNonNullValuesLength(currentRound);
  // }

  private buildMessagePayload = <T extends UDPDataInfo>(
    type: MessageType,
    data: T,
    recipient: number,
  ): MessagePayload<T> => {
    return {
      description: `${recipient} Recieved Peer discovery ${type} from ${this.nodeId}`,
      type,
      data,
    };
  };

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export default KademliaNode;
