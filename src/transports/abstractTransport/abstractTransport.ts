import dgram from "dgram";
import { Server } from "ws";

export interface BaseTransport<TransportType extends dgram.Socket | Server> {
  address: string;
  nodeId: number;
  port: number;
  server: TransportType;
}

class AbstractTransport<TransportType extends dgram.Socket | Server> implements BaseTransport<TransportType> {
  public readonly address: string;
  public readonly nodeId: number;
  public readonly port: number;
  public server: TransportType;

  constructor(nodeId: number, port: number, server: TransportType) {
    this.nodeId = nodeId;
    this.port = port;
    this.address = "127.0.0.1";
    this.server = server;
  }
}

export default AbstractTransport;
