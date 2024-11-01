import dgram from "dgram";
import { Message, MessagePayload, UDPDataInfo } from "../../message/message";
import { MessageType } from "../../message/types";
import { extractError } from "../../utils/extractError";
import { timeoutReject } from "../../utils/nodeUtils";
import AbstractTransport, { BaseMessageType } from "../abstractTransport/abstractTransport";

class UDPTransport extends AbstractTransport<dgram.Socket, BaseMessageType> {
  constructor(nodeId: number, port: number) {
    super(nodeId, port, dgram.createSocket("udp4"));
    this.setupListeners();
  }

  public setupListeners() {
    return new Promise((resolve, reject) => {
      try {
        this.server.bind(
          {
            port: this.port,
            address: this.address,
          },
          () => resolve(this.listen()),
        );
      } catch (error) {
        reject(error);
      }
    });
  }

  public listen(cb?: () => void): (cb?: any) => void {
    this.messages = {
      [MessageType.FindNode]: new Map<string, any>(),
      [MessageType.Reply]: new Map<string, any>(),
      [MessageType.Ping]: new Map<string, any>(),
    };
    return (cb) => this.close(cb);
  }

  public sendMessage = async <T extends MessagePayload<UDPDataInfo>>(
    message: Message<T>,
    callback?: (params: any, resolve: (value?: unknown) => void, reject: (reason?: any) => void) => void,
  ): Promise<number[] | undefined> => {
    try {
      const nodeResponse = new Promise<number[]>((resolve, reject) => {
        const payload = JSON.stringify({ ...message });
        const recipient = Number(message.to.address);

        this.server.send(payload, recipient, this.address, () => {
          const args = { type: message.type, data: message.data, responseId: message.data.data.resId };
          callback(args, resolve, reject);
        });
      });
      const error = new Error(`TIMEOUT: ${Number(message.to.address)}`);
      return Promise.race([nodeResponse, timeoutReject<number[]>(error)]);
    } catch (error) {
      console.error(`message: ${extractError(error)}, fn: sendMessage UDPTransport`);
      return [] as number[];
    }
  };

  public onMessage<T extends (msg: Buffer, info: dgram.RemoteInfo) => Promise<void>>(callback: T) {
    this.server.on("message", (message, remoteInfo) => {
      callback(message, remoteInfo);
    });
  }

  public close(callback?: () => void) {
    this.server.removeAllListeners("message");
    this.server.close(callback);
  }
}

export default UDPTransport;
