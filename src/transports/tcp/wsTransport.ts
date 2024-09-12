import { Server, WebSocket } from "ws";
// import { Neighbours } from "../contacts/contacts";
// import { IContact } from "../contacts/types";
import { Listener, P2PNetworkEventEmitter } from "../../node/eventEmitter";
import { ErrorWithCode, ProtocolError } from "../../utils/errors";

type NodeID = string; // Node ID as a string, typically represented as a hexadecimal string
type Contact = { nodeId: NodeID; ip: string; port: number };

class WebSocketTransport {
  public readonly connections: Map<string, WebSocket>;
  public readonly nodeId: number;
  public readonly port: number;
  public readonly neighbors: Map<string, string>;

  public on: (event: string, listener: (...args: any[]) => void) => void;
  public off: (event: string, listener: (...args: any[]) => void) => void;

  private readonly emitter: P2PNetworkEventEmitter;
  private server: Server;

  constructor(nodeId: number, port: number) {
    this.connections = new Map();
    this.neighbors = new Map();

    this.nodeId = nodeId;
    this.port = port;

    this.server = new WebSocket.Server({ port });
    this.emitter = new P2PNetworkEventEmitter(false);
    this.emitter.on.bind(this.emitter);
    this.emitter.off.bind(this.emitter);

    this.on = (e: string, l: Listener) => this.emitter.on(e, l);
    this.off = (e: string, l: Listener) => this.emitter.on(e, l);
    this.setupListeners();
  }

  private setupListeners = (): void => {
    this.emitter.on("_connect", (connectionId) => {
      this.sendMessage(connectionId.connectionId, {
        type: "handshake",
        data: { nodeId: this.nodeId },
      });
    });

    this.emitter.on("_message", async ({ connectionId, message }) => {
      const { type, data } = message;
      if (type === "handshake") {
        this.neighbors.set(connectionId, connectionId);
        this.emitter.emitConnect(data.nodeId, true);
      }

      if (type === "message") {
        this.emitter.emitMessage(connectionId, data, true);
      }
    });

    this.emitter.on("_disconnect", (connectionId) => {
      this.neighbors.delete(connectionId);
      this.emitter.emitDisconnect(connectionId, true);
    });

    this.emitter.on("message", (message) => {
      this.handlePeerMessage(message);
    });
  };

  private sendMessage = (connectionId: string, message: any) => {
    const socket = this.connections.get(connectionId);
    if (!socket)
      throw new ErrorWithCode(
        `Attempt to send data to connection that does not exist ${connectionId}`,
        ProtocolError.INTERNAL_ERROR,
      );

    socket.send(JSON.stringify(message));
  };
}

export default WebSocketTransport;
