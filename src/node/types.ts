export enum NodeState {
  Online = "Online",
  OffLine = "OffLine",
}

export interface RoutingTable {
  node_id: number;
  ip: string;
  port: number;
}

export interface PingResponse {
  status: boolean;
  buckets: number[];
  msg: string;
}

export interface FindNodeResponse {
  found: boolean;
  route: number[];
  nodeId?: number;
  error?: string;
}

export interface SaveValueResponse {
  found: boolean;
  value: string | null;
}
