import * as dgram from "dgram";
import { Socket } from "dgram";
import express from "express";
import { Contacts } from "../neighbours/neighbours";
import { IContact } from "../neighbours/types";
// import { Neighbours } from "../contacts/contacts";
// import { IContact } from "../contacts/types";
import { PORT_NUMBER } from "./constants";
import { sha1 } from "./utils";

type NodeID = string; // Node ID as a string, typically represented as a hexadecimal string
type Contact = { nodeId: NodeID; ip: string; port: number };

class KademliaNode {
  //   public nodeId: number;
  public ipAddress: string = "localhost";
  public port: number;
  public nodeId: NodeID;
  private readonly contacts: Contacts;

  private app = express();
  private socket: Socket;

  constructor(id: number, port: number) {
    this.nodeId = sha1(`127.0.0.1:${port}`).digest("hex");
    this.port = port;
    this.contacts = new Contacts();
    this.socket = dgram.createSocket("udp4");
    this.socket.on("message", this.handleRPC);
  }

  public async start() {
    try {
      this.socket.bind(this.port, () => {
        this.contacts.setMe(this.contact());
        const bootstrap = {
          ip: "127.0.0.1",
          port: PORT_NUMBER,
          nodeId: sha1(`127.0.0.1:${PORT_NUMBER}`).digest("hex"),
        };
        this.send(bootstrap, "PING", this.contact());
      });
    } catch (err) {
      console.log(err);
    }
  }

  public contact(): IContact {
    const address = this.socket.address();

    return {
      nodeId: this.nodeId,
      ip: address.address,
      port: address.port,
    };
  }
  private send = (contact: any, type: any, data: any) => {
    const message = JSON.stringify({
      type,
      data: data,
      fromNodeId: this.nodeId,
    });

    this.socket.send(message, contact.port, contact.ip);
  };

  private handleRPC = (msg: Buffer, info: dgram.RemoteInfo) => {
    try {
      const message = JSON.parse(msg.toString());
      const remoteContact = makeContact(message.fromNodeId, info);
      this.contacts.addContacts(remoteContact);

      // console.log("r reply", remoteContact);

      switch (message.type) {
        case "REPLY":
          console.log("recieved reply", this.contacts.contacts);
          break;
        case "PING": {
          this.send(remoteContact, "REPLY", this.contact());
          break;
        }
        //   case 'STORE':
        //       await this.contacts.store(message as TStoreRPC, info);
        //       await this.replyRPC(remoteContact, {rpcId: message.rpcId});
        //       break;
        //   case 'FIND_NODE':
        //       const contacts = this.contacts.findNode(remoteContact.nodeId);
        //       await this.sendNodes(message.rpcId, remoteContact, contacts);
        //       break;
        //   case 'FIND_VALUE':
        //       const result = await this.contacts.findValue((message as TFindValueRPC).data.key);
        //       if (Array.isArray(result)) {
        //           await this.sendNodes(message.rpcId, remoteContact, result);
        //       } else {
        //           await this.sendValue(message.rpcId, remoteContact, result);
        //       }
        //       break;
        default:
          // TODO: log, throw exception
          return;
      }
    } catch (error) {
      console.error(error);
    }
  };

  public close() {
    this.socket.removeAllListeners("message");
    this.socket.close();
  }
}

export function makeContact(hexNodeId: string, info: dgram.RemoteInfo): any {
  return {
    nodeId: hexNodeId,
    ip: info.address,
    port: info.port,
  };
}
export default KademliaNode;
