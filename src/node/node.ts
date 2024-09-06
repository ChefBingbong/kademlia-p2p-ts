import * as dgram from "dgram";
import { Socket } from "dgram";
import express from "express";
import { KBucket } from "../kBucket/kBucket";
import { TType } from "../neighbours/types";
// import { Neighbours } from "../contacts/contacts";
// import { IContact } from "../contacts/types";
import { BIT_SIZE } from "./constants";

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
  //   public nodeId: number;
  public peers: Map<number, number>;
  public address: string;
  public port: number;
  public nodeId: number;
  private readonly buckets: Map<number, KBucket>;

  private app = express();
  private socket: Socket;
  private rpcMap: Map<string, { resolve: Function; type: TType }>;

  constructor(id: number, port: number) {
    this.nodeId = id;
    this.port = port;
    this.address = "127.0.0.1";
    this.table = new Map();
    this.buckets = new Map();
    this.socket = dgram.createSocket("udp4");
    this.socket.on("message", this.handleRPC);
  }
}

export default KademliaNode;
