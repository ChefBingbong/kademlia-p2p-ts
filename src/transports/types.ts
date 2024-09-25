//heres a simple but effective use or really basic generics
// heres the generic types for generic TCP Messages. For my TCP transport there
// are two messages Broadcast and direct. So the data we want to send in a base message
// will be slightly different depending on whether the message is a dm or bm. So the Tcp
// packet will take in a generic message where the generic represents the data field. here we
//define that the data can extend either thr Directdata or the Broadcast Data dependng on which wwre sending
export type TcpMessageType = "broadcast-message" | "direct-message";

export type CommonTcpData = {
  type: TcpMessageType;
  message: string;
};

export type BroadcastData = CommonTcpData & {
  peers: number[];
};

export type DirectData = CommonTcpData & {
  to: number;
};

export type HandShake = { nodeId: number };

export type TcpData = BroadcastData | DirectData | HandShake;

export type TcpMessage<T extends TcpData> = {
  type: TcpMessageType;
  message: string;
  data?: T;
  to?: string;
};

export type TcpPacket<T extends TcpData | null> = {
  id: string;
  ttl: number;
  type: "broadcast" | "direct";
  destination?: string;
  message: TcpMessage<T>;
  origin: string;
};
