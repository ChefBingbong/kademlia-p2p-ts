import * as crypto from "crypto";
import * as dgram from "dgram";
import { Contacts } from "../contacts//contacts";
import {
  IContact,
  IListenOptions,
  IRPCMessage,
  IRPCOptions,
  IResult,
  TFindValueRPC,
  TStoreRPC,
  TType,
} from "../contacts/types";
import { makeContact, sha1, timeout } from "./utils";

export class Node {
  private nodeId: Buffer;
  private socket: dgram.Socket;
  private contacts: Contacts;
  private rpcMap: Map<string, { resolve: Function; type: TType }>;

  constructor(options?: INodeOptions) {
    this.socket = dgram.createSocket("udp4");
    this.rpcMap = new Map();

    this.contacts = options.contacts;
    this.socket.on("message", this.handleRPC);
  }

  public listen(options: IListenOptions) {
    this.nodeId = options.nodeId;
    return new Promise<void>((res, rej) => {
      try {
        this.socket.bind(
          {
            port: options.port,
            address: options.address,
          },
          () => {
            this.contacts.setMe(this.contact());
            res();
          },
        );
      } catch (err) {
        rej(err);
      }
    });
  }

  private handleRPC = async (msg: Buffer, info: dgram.RemoteInfo) => {
    try {
      const me = this.contact();
      // console.log(`${me.nodeId.toString('hex')} got: ${msg} ${info.address}:${info.port} -> ${me.ip}:${me.port}`);

      const message: IRPCMessage<unknown> = JSON.parse(msg.toString());
      const remoteContact = makeContact(message.nodeId, info);
      await this.contacts.addContacts(remoteContact);

      switch (message.type) {
        case "REPLY":
          await this.handleReply(message.rpcId, (message as IRPCMessage<"REPLY">).data);
          break;
        case "PING":
          await this.pong(message.rpcId, remoteContact);
          break;
        case "STORE":
          await this.contacts.store(message as TStoreRPC, info);
          await this.replyRPC(remoteContact, { rpcId: message.rpcId });
          break;
        case "FIND_NODE": {
          const contacts = this.contacts.findNode(remoteContact.nodeId);
          await this.sendNodes(message.rpcId, remoteContact, contacts);
          break;
        }
        case "FIND_VALUE": {
          const result = await this.contacts.findValue((message as TFindValueRPC).data.key);
          if (Array.isArray(result)) {
            await this.sendNodes(message.rpcId, remoteContact, result);
          } else {
            await this.sendValue(message.rpcId, remoteContact, result);
          }
          break;
        }
        default:
          // TODO: log, throw exception
          return;
      }
    } catch (error) {
      console.error(error);
    }
  };

  public contact(): IContact {
    const address = this.socket.address();

    return {
      nodeId: this.nodeId,
      ip: address.address,
      port: address.port,
    };
  }

  public close() {
    this.socket.removeAllListeners("message");
    this.socket.close();
  }

  public ping(contact: IContact) {
    return this.callRPC("PING", contact);
  }

  public pong(rpcId: string, contact: IContact) {
    return this.replyRPC(contact, { rpcId });
  }

  public sendNodes(rpcId: string, remoteContact: IContact, contacts: Array<IContact>) {
    return this.replyRPC(remoteContact, {
      rpcId,
      data: {
        contacts,
      },
    });
  }

  public sendValue(rpcId: string, remoteContact: IContact, result: string) {
    return this.replyRPC(remoteContact, {
      rpcId,
      data: result,
    });
  }

  public handleReply(rpcId: string, data: IRPCMessage<unknown>["data"]) {
    const rpc = this.rpcMap.get(rpcId);
    if (!rpc) {
      // Perhaps timed out
      return;
    }

    if (rpc.type === "FIND_NODE") {
      const { contacts } = data as IRPCMessage<"FIND_NODE">["data"];
      const result: Array<IContact> = [];

      for (const contact of contacts) {
        result.push({
          ...contact,
          nodeId: Buffer.from(contact.nodeId.data),
        });
      }

      this.rpcMap.get(rpcId)?.resolve(data);
      return;
    }

    this.rpcMap.get(rpcId)?.resolve(data);
  }

  public async callRPC<T extends TType>(
    type: T,
    contact: IContact,
    options: IRPCOptions<T> = {},
    // biome-ignore lint/suspicious/noConfusingVoidType: <explanation>
  ): Promise<IResult[T] | void> {
    const rpcId = options.rpcId || sha1(crypto.randomBytes(4).toString()).digest("hex");

    // biome-ignore lint/suspicious/noConfusingVoidType: <explanation>
    const promise = new Promise<IResult[T] | void>((resolve, reject) => {
      const message = JSON.stringify({
        type,
        rpcId,
        data: options.data,
        nodeId: this.nodeId.toString("hex"),
      });

      this.socket.send(message, contact.port, contact.ip, (error) => {
        if (error) {
          return reject(error);
        }

        if (type === "REPLY") {
          // TODO: ACK?
          resolve();
        } else {
          this.rpcMap.set(rpcId, {
            resolve,
            type,
          });
        }
      });
    });

    try {
      const error = new Error(`timeout error: ${type}`);
      Error.captureStackTrace(error);
      // biome-ignore lint/suspicious/noConfusingVoidType: <explanation>
      const result: IResult[T] | void = await timeout(promise, options.timeout ?? 30000, error);

      return result;
    } finally {
      this.rpcMap.delete(rpcId);
    }
  }

  private replyRPC<T>(contact: IContact, options: T) {
    return this.callRPC("REPLY", contact, options);
  }
}

interface INodeOptions {
  nodeId?: Buffer;
  contacts: Contacts;
}
