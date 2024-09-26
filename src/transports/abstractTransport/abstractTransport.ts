import dgram from "dgram";
import { Server } from "ws";
import { MessageType } from "../../message/types";

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
}

export default AbstractTransport;
