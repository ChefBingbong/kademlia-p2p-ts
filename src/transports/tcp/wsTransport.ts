import { v4 } from "uuid";
import { Server, WebSocket } from "ws";
import { MessageType } from "../../message/types";
import { Listener, P2PNetworkEventEmitter } from "../../node/eventEmitter";
import { ErrorWithCode, ProtocolError } from "../../utils/errors";

export type TCPMessage = { type: string; message: string; to: string };

class WebSocketTransport {
  public readonly connections: Map<string, WebSocket>;
  public readonly nodeId: number;
  public readonly port: number;
  public readonly ports: number[];
  public readonly neighbors: Map<string, string>;

  public on: (event: string, listener: (...args: any[]) => void) => void;
  public off: (event: string, listener: (...args: any[]) => void) => void;

  private readonly emitter: P2PNetworkEventEmitter;
  private isInitialized: boolean = false;
  public server: Server;

  public messages: Partial<{ [key in MessageType]: Map<string, any> }> = {
    [MessageType.Braodcast]: new Map<string, any>(),
    [MessageType.DirectMessage]: new Map<string, any>(),
  };

  constructor(nodeId: number, port: number, ports: number[]) {
    this.connections = new Map();
    this.neighbors = new Map();

    this.nodeId = nodeId;
    this.port = port;
    this.ports = ports;

    this.server = new WebSocket.Server({ port });
    this.emitter = new P2PNetworkEventEmitter(false);
    this.emitter.on.bind(this.emitter);
    this.emitter.off.bind(this.emitter);

    this.on = (e: string, l: Listener) => this.emitter.on(e, l);
    this.off = (e: string, l: Listener) => this.emitter.on(e, l);
    this.setupListeners();
  }

  public setupListeners = (): void => {
    this.on("_connect", (connectionId) => {
      this._send(connectionId.connectionId, {
        type: "handshake",
        data: { nodeId: this.nodeId },
      });
    });

    this.on("_message", async ({ connectionId, message }) => {
      const { type, data } = message;
      console.log(connectionId, message);
      if (type === "handshake") {
        this.neighbors.set(connectionId, connectionId);
        this.emitter.emitConnect(data.nodeId, true);
      }

      if (type === "message") {
        this.emitter.emitMessage(connectionId, data, true);
      }
    });

    this.on("_disconnect", (connectionId) => {
      this.neighbors.delete(connectionId);
      this.emitter.emitDisconnect(connectionId, true);
    });

    this.emitter.on("message", ({ nodeId, data: packet }) => {
      if (this.messages.BROADCAST.has(packet.id) || packet.ttl < 1) return;

      const message = JSON.stringify({ id: packet.id, msg: packet.message.message });
      this.messages.BROADCAST.set(packet.id, message);

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
  };

  public listen(cb?: () => void): (cb?: any) => void {
    if (!this.isInitialized)
      throw new ErrorWithCode(`Cannot listen before server is initialized`, ProtocolError.PARAMETER_ERROR);

    this.connect(this.port, () => {
      console.log(`Connection to ${this.port} established.`);
    });

    this.server.on("connection", (socket) => {
      this.handleNewSocket(socket, this.nodeId, () => {
        console.log(`Connection to ${this.port} established.`);
      });
    });

    return (cb) => this.server.close(cb);
  }

  public connect = (port: number, cb?: () => void) => {
    console.log(port);
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

  public handleNewSocket = (socket: WebSocket, nodeId: number, callback?: () => void) => {
    const connectionId = nodeId.toString();

    this.connections.set(connectionId, socket);
    this.emitter.emitConnect(connectionId, false);

    socket.on("message", (message: any) => {
      const receivedData = JSON.parse(message);
      this.emitter.emitMessage(connectionId, receivedData, false);
    });

    socket.on("close", () => {
      this.connections.delete(connectionId);
      this.emitter.emitDisconnect(connectionId, false);
    });

    socket.on("error", (err) => {
      console.log(err);
      console.error(`Socket connection error: ${err.message}`);
    });

    return () => socket.terminate();
  };

  // message sending logic
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
    const message = JSON.stringify({ id: packet.id, msg: packet.message.message });

    if (packet.type === "direct") {
      this.send(packet.destination, packet);
      this.messages.DIRECT_MESSAGE.set(packet.id, message);
    } else {
      for (const $nodeId of this.neighbors.keys()) {
        this.send($nodeId, packet);
        this.messages.BROADCAST.set(packet.id, message);
      }
    }
  };

  private send = (nodeId: string, data: any) => {
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

  // event handler logic
  public onPeerConnection = (callback?: () => Promise<void>) => {
    this.on("connect", async ({ nodeId }: { nodeId: string }) => {
      console.log(`New node connected: ${nodeId}`);
      try {
        await callback();
      } catch (error) {
        console.log(error);
        throw new ErrorWithCode(`Error handling peer connection for ${this.port}`, ProtocolError.INTERNAL_ERROR);
      }
    });
  };

  public onPeerDisconnect = (callback?: () => Promise<void>) => {
    this.on("disconnect", async ({ nodeId }: { nodeId: string }) => {
      console.log(`Node disconnected: ${nodeId}`);
      try {
        await callback();
      } catch (error) {
        console.log(error);
        throw new ErrorWithCode(`Error handling peer disconnection for ${this.port}`, ProtocolError.INTERNAL_ERROR);
      }
    });
  };

  public onBroadcastMessage = (callback?: () => Promise<void>) => {
    this.on("broadcast", async ({ message }: { message: any }) => {
      try {
        await callback();
      } catch (error) {
        console.log(error);
        throw new ErrorWithCode(`Error prcessing broadcast message for ${this.port}`, ProtocolError.INTERNAL_ERROR);
      }
    });
  };

  public onDirectMessage = (callback?: () => Promise<void>) => {
    this.on("direct", async ({ message }: { message: any }) => {
      try {
        await callback();
      } catch (error) {
        console.log(error);
        throw new ErrorWithCode(`Error prcessing direct message for ${this.port}`, ProtocolError.INTERNAL_ERROR);
      }
    });
  };
}

export default WebSocketTransport;
