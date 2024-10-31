import { Server, WebSocket } from "ws";
import { Message } from "../../message/message";
import { MessageType, PacketType } from "../../message/types";
import { Listener, P2PNetworkEventEmitter } from "../../node/eventEmitter";
import { ErrorWithCode, ProtocolError } from "../../utils/errors";
import AbstractTransport, {
  BaseMessageType,
} from "../abstractTransport/abstractTransport";
import {
  BroadcastData,
  DirectData,
  HandShake,
  TcpData,
  TcpPacket,
} from "../types";

export type TCPMessage = { type: string; message: string; to: string };
type OnMessagePayload<T extends BroadcastData | DirectData> = {
  connectionId: string;
  message: { type: "message" | "handshake"; data: HandShake | TcpPacket<T> };
};

class WebSocketTransport extends AbstractTransport<Server, BaseMessageType> {
  public readonly connections: Map<string, WebSocket>;
  public readonly neighbors: Map<string, string>;

  public on: (event: string, listener: (...args: any[]) => void) => void;
  public off: (event: string, listener: (...args: any[]) => void) => void;

  private readonly emitter: P2PNetworkEventEmitter;
  private isInitialized: boolean = false;

  constructor(nodeId: number, port: number) {
    super(nodeId, port, new WebSocket.Server({ port }));
    this.connections = new Map();
    this.neighbors = new Map();

    this.emitter = new P2PNetworkEventEmitter(false);
    this.emitter.on.bind(this.emitter);
    this.emitter.off.bind(this.emitter);

    this.on = (e: string, l: Listener) => this.emitter.on(e, l);
    this.off = (e: string, l: Listener) => this.emitter.on(e, l);
    this.setupListeners();
  }

  public setupListeners = (): void => {
    this.messages = {
      [MessageType.Braodcast]: new Map<string, any>(),
      [MessageType.DirectMessage]: new Map<string, any>(),
    };

    this.on("_connect", ({ connectionId }: { connectionId: string }) => {
      const payload: HandShake = { nodeId: this.nodeId };
      this.send(connectionId, PacketType.HandShake, payload);
    });

    this.on("_disconnect", (connectionId) => {
      this.neighbors.delete(connectionId);
      this.emitter.emitDisconnect(connectionId, true);
    });

    this.on(
      "_message",
      async <T extends BroadcastData | DirectData>(
        pkt: OnMessagePayload<T>
      ) => {
        switch (pkt.message.type) {
          case PacketType.HandShake:
            const { nodeId } = pkt.message.data as HandShake;
            this.neighbors.set(pkt.connectionId, pkt.connectionId);
            this.emitter.emitConnect(nodeId.toString(), true);
            break;
          case PacketType.Message: {
            const data = pkt.message.data as TcpPacket<T>;
            this.emitter.emitMessage(pkt.connectionId, data, true);
            break;
          }
        }
      }
    );

    this.emitter.on(
      "message",
      <T extends BroadcastData | DirectData>({
        data: message,
      }: {
        data: Message<TcpPacket<T>>;
      }) => {
        if (
          this.messages.BROADCAST.has(message.data.id) ||
          message.data.ttl < 1
        )
          return;

        if (message.data.type === PacketType.Broadcast) {
          this.messages.BROADCAST.set(message.data.id, message.data.message);
          this.sendMessage<T>(message);
          this.emitter.emitBroadcast(message.data.message, message.data.origin);
        }

        if (message.data.type === PacketType.Direct) {
          if (message.data.destination === this.port.toString()) {
            this.emitter.emitDirect(message.data.message, message.data.origin);
          } else {
            // TO-DO fix this newMessage ttl reEval is wrong
            const newMessage = { ...message, ttl: message.data.ttl - 1 };
            this.sendMessage<T>(newMessage);
          }
        }
      }
    );

    this.isInitialized = true;
    this.listen();
  };

  public listen(cb?: () => void): (cb?: any) => void {
    if (!this.isInitialized)
      throw new ErrorWithCode(
        `Cannot listen before server is initialized`,
        ProtocolError.PARAMETER_ERROR
      );

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
      this.handleNewSocket(socket, port - 3000);
      cb?.();
    });

    return () => socket.terminate();
  };

  public handleNewSocket = (
    socket: WebSocket,
    nodeId: number,
    callback?: () => void
  ) => {
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

  public sendMessage = <T extends BroadcastData | DirectData>(
    message: Message<TcpPacket<T>>
  ) => {
    switch (message.data.type) {
      case PacketType.Direct:
        this.send(message.data.destination, PacketType.Message, message);
        this.messages.DIRECT_MESSAGE.set(message.data.id, message);
        break;
      case PacketType.Broadcast: {
        for (const $nodeId of this.neighbors.keys()) {
          this.send($nodeId, PacketType.Message, message);
          this.messages.BROADCAST.set(message.data.id, message);
        }
      }
    }
  };

  private send = <T extends TcpData>(
    nodeId: string,
    type: "message" | "handshake",
    data: Message<TcpPacket<T>> | HandShake
  ) => {
    const connectionId = this.neighbors.get(nodeId) ?? nodeId;
    const socket = this.connections.get(connectionId);

    if (!socket)
      throw new ErrorWithCode(
        `Attempt to send data to connection that does not exist ${connectionId}`,
        ProtocolError.INTERNAL_ERROR
      );

    socket.send(JSON.stringify({ type, data }));
  };

  // event handler logic
  public onMessage<
    T extends (message: TcpPacket<BroadcastData | DirectData>) => Promise<void>,
    R = PacketType
  >(callback: T, type: R) {
    switch (type) {
      case PacketType.Broadcast:
        this.on(
          "broadcast",
          async <T extends BroadcastData>(message: TcpPacket<T>) => {
            try {
              await callback(message);
            } catch (error) {
              console.log(error);
              throw new ErrorWithCode(
                `Error prcessing broadcast message for ${this.port}`,
                ProtocolError.INTERNAL_ERROR
              );
            }
          }
        );
        break;
      case PacketType.Direct:
        this.on(
          "direct",
          async <T extends DirectData>(message: TcpPacket<T>) => {
            try {
              await callback(message);
            } catch (error) {
              console.log(error);
              throw new ErrorWithCode(
                `Error prcessing direct message for ${this.port}`,
                ProtocolError.INTERNAL_ERROR
              );
            }
          }
        );
    }
  }

  public onPeerConnection = (callback?: () => Promise<void>) => {
    this.on("connect", async ({ nodeId }: { nodeId: string }) => {
      console.log(`New node connected: ${nodeId}`);
      try {
        await callback();
      } catch (error) {
        console.log(error);
        throw new ErrorWithCode(
          `Error handling peer connection for ${this.port}`,
          ProtocolError.INTERNAL_ERROR
        );
      }
    });
  };

  public onPeerDisconnect = (callback?: (args: any) => Promise<void>) => {
    this.on(
      "disconnect",
      async ({ nodeId }: { nodeId: { connectionId: string } }) => {
        console.log(`Node disconnected: ${nodeId.connectionId}`);
        try {
          await callback(Number(nodeId.connectionId));
        } catch (error) {
          console.log(error);
          throw new ErrorWithCode(
            `Error handling peer disconnection for ${this.port}`,
            ProtocolError.INTERNAL_ERROR
          );
        }
      }
    );
  };
}

export default WebSocketTransport;
