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
