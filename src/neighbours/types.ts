export interface IContact {
  ip: string;
  port: number;
  nodeId: string;
}

export interface IKBucketOptions {
  maxContacts: number;
}

export interface IDHTOptions {
  address: string;
  port: number;
}

export interface IRPCMessage<T extends TType | unknown> {
  type: T;
  rpcId: string;
  nodeId: string;
  data: T extends TType ? IRPCArguments[T] : unknown;
}

export interface IRPCArguments {
  STORE: IStoreMessage;
  FIND_VALUE: IFindValue;
  FIND_NODE: IFindNode;
  PING: void;
  REPLY: IResult["STORE"] | IResult["FIND_NODE"] | IResult["FIND_NODE"] | void;
}

export interface IResult {
  STORE: void;
  FIND_VALUE: string;
  FIND_NODE: Array<IContact>;
  PING: void;
  REPLY: void;
}

export interface IFindNode {
  contacts: Array<IContactJSON>;
}

export type TFindResult = string | IFindNode;

export type TStoreRPC = IRPCMessage<"STORE">;
export type TFindValueRPC = IRPCMessage<"FIND_VALUE">;

export interface IListenOptions {
  port: number;
  address: string;
  nodeId: Buffer;
}

export interface IConnectOptions {
  port: number;
  address?: string;
}

/**
 * While this is not formally specified, it is clear that the initial STORE message must contain in addition to the message ID
 * at least the data to be stored (including its length) and the associated key.
 * As the transport may be UDP, the message needs to also contain at least the nodeID of the sender,
 * and the reply the nodeID of the recipient.
 * The reply to any RPC should also contain an indication of the result of the operation.
 * For example, in a STORE while no maximum data length has been specified,
 * it is clearly possible that the receiver might not be able to store the data,
 * either because of lack of space or because of an I/O error.
 */
export interface IStoreMessage {
  key: string;
  block: string; // hex bytes?
  length?: number; // size of full length?
}

export interface IReplyFindNode {
  contacts: Array<IContact>;
}

export interface IFindValue {
  key: string;
}

export type TFoundNodes = Array<IContact>;

export type TType = "PING" | "REPLY" | "STORE" | "FIND_NODE" | "FIND_VALUE";

export interface IRPCOptions<T> {
  rpcId?: string;
  data?: T extends TType ? IRPCArguments[T] : unknown;
  timeout?: number;
}

export interface IContactJSON {
  nodeId: {
    type: "Buffer";
    data: Array<number>;
  };
  ip: string;
  port: number;
}
