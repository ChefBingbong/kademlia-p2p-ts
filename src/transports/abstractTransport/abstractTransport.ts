import dgram from "dgram";
import { Server } from "ws";
import { Message, MessagePayload, UDPDataInfo } from "../../message/message";
import { MessageType, PacketType } from "../../message/types";
import { BroadcastData, DirectData, TcpPacket } from "../types";

export type BaseMessageType = Partial<{ [key in MessageType]: Map<string, any> }>;

export interface BaseTransport<TransportType extends dgram.Socket | Server, TMessage extends BaseMessageType> {
  address: string;
  nodeId: number;
  port: number;
  server: TransportType;
  messages: TMessage;
}

abstract class AbstractTransport<TransportType extends dgram.Socket | Server, TMessage>
  implements BaseTransport<TransportType, TMessage>
{
  public readonly address: string;
  public readonly nodeId: number;
  public readonly port: number;

  public server: TransportType;
  public messages: TMessage;

  constructor(nodeId: number, port: number, server: TransportType) {
    this.nodeId = nodeId;
    this.port = port;
    this.address = "127.0.0.1";
    this.server = server;
  }

  abstract setupListeners(): void;
  abstract listen(): void;

  abstract onMessage<T extends (args?: any) => Promise<void>, R extends PacketType>(callback: T, type?: R): void;
  abstract sendMessage<T extends TcpPacket<BroadcastData | DirectData> & MessagePayload<UDPDataInfo>>(
    message: Message<T>,
  ): void;
}

export default AbstractTransport;
