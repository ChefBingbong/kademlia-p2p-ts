import { Server, WebSocket } from "ws";
import { MessageType } from "../../message/types";
import { Listener, P2PNetworkEventEmitter } from "../../node/eventEmitter";
import { ErrorWithCode, ProtocolError } from "../../utils/errors";
import { BroadcastData, DirectData, HandShake, TcpData, TcpPacket } from "../types";

export type TCPMessage = { type: string; message: string; to: string };
type OnMessagePayload<T extends BroadcastData | DirectData> = {
  connectionId: string;
  message: { type: "message" | "handshake"; data: HandShake | TcpPacket<T> };
};

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
    this.on("_connect", ({ connectionId }: { connectionId: string }) => {
      const payload: HandShake = { nodeId: this.nodeId };
      this.send(connectionId, "handshake", payload);
    });

    this.on("_disconnect", (connectionId) => {
      this.neighbors.delete(connectionId);
      this.emitter.emitDisconnect(connectionId, true);
    });

    this.on("_message", async <T extends BroadcastData | DirectData>(pkt: OnMessagePayload<T>) => {
      switch (pkt.message.type) {
        case "handshake":
          const { nodeId } = pkt.message.data as HandShake;
          this.neighbors.set(pkt.connectionId, pkt.connectionId);
          this.emitter.emitConnect(nodeId.toString(), true);
          break;
        case "message": {
          const data = pkt.message.data as TcpPacket<T>;
          this.emitter.emitMessage(pkt.connectionId, data, true);
          break;
        }
      }
    });

    this.emitter.on("message", <T extends BroadcastData | DirectData>({ data: packet }: { data: TcpPacket<T> }) => {
      if (this.messages.BROADCAST.has(packet.id) || packet.ttl < 1) return;

      if (packet.type === "broadcast") {
        this.messages.BROADCAST.set(packet.id, packet.message);
        this.sendMessage<T>(packet);
        this.emitter.emitBroadcast(packet.message, packet.origin);
      }

      if (packet.type === "direct") {
        if (packet.destination === this.port.toString()) {
          this.emitter.emitDirect(packet.message, packet.origin);
        } else {
          const newMessage = { ...packet, ttl: packet.ttl - 1 };
          this.sendMessage<T>(newMessage);
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

  public sendMessage = <T extends BroadcastData | DirectData>(packet: TcpPacket<T>) => {
    const message = JSON.stringify({ id: packet.id, msg: packet.message.message });
    switch (packet.type) {
      case "direct":
        this.send(packet.destination, "message", packet);
        this.messages.DIRECT_MESSAGE.set(packet.id, message);
        break;
      case "broadcast": {
        for (const $nodeId of this.neighbors.keys()) {
          this.send($nodeId, "message", packet);
          this.messages.BROADCAST.set(packet.id, message);
        }
      }
    }
  };

  private send = <T extends TcpData>(nodeId: string, type: "message" | "handshake", data: TcpPacket<T> | HandShake) => {
    const connectionId = this.neighbors.get(nodeId) ?? nodeId;
    const socket = this.connections.get(connectionId);

    if (!socket)
      throw new ErrorWithCode(
        `Attempt to send data to connection that does not exist ${connectionId}`,
        ProtocolError.INTERNAL_ERROR,
      );

    console.log(data);
    socket.send(JSON.stringify({ type, data }));
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
    this.on("broadcast", async <T extends BroadcastData>(message: TcpPacket<T>) => {
      try {
        await callback();
      } catch (error) {
        console.log(error);
        throw new ErrorWithCode(`Error prcessing broadcast message for ${this.port}`, ProtocolError.INTERNAL_ERROR);
      }
    });
  };

  public onDirectMessage = (callback?: () => Promise<void>) => {
    this.on("direct", async <T extends BroadcastData>(message: TcpPacket<T>) => {
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
