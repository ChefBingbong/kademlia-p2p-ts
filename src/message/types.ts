import { Message } from "./message";

export interface Queue<T> {
  [partyId: string]: T | null;
}

export interface MessageQueue<T> {
  [roundNumber: number]: Queue<T>;
}

export type ServerMessage<T extends Message<T>> = {
  message: string;
  type: MessageType;
  transport: Transports;
  data: T;
  senderNode: string;
};

export type UpdMessage<T extends Message<T>> = ServerMessage<T> & {
  resId: string;
};

// biome-ignore lint/complexity/noUselessTypeConstraint: <explanation>
export type TransactionData<T extends any = {}> = {
  type: string;
  data: T;
};

export enum Transports {
  Udp = "UDP",
  Tcp = "TCP",
}

export enum MessageType {
  Braodcast = "BROADCAST",
  DirectmESSAGE = "DIRECT-MESSAGE",
  PeerDiscovery = "PEER-DISCOVER",
  Handshake = "HANDSHAKE",
}
