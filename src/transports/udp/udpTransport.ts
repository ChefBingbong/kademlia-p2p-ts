import dgram from "dgram";
import { Message, MessagePayload, UDPDataInfo } from "../../message/message";
import { MessageType } from "../../message/types";
import { timeoutReject } from "../../node/utils";
import { extractError } from "../../utils/extractError";

class UDPTransport {
  public readonly address: string;
  public readonly nodeId: number;
  public readonly port: number;

  private socket: dgram.Socket;

  public messages: Partial<{ [key in MessageType]: Map<string, Message<MessagePayload<UDPDataInfo>>> }> = {
    [MessageType.FindNode]: new Map<string, Message<MessagePayload<UDPDataInfo>>>(),
    [MessageType.Reply]: new Map<string, Message<MessagePayload<UDPDataInfo>>>(),
  };

  constructor(nodeId: number, port: number) {
    this.nodeId = nodeId;
    this.port = port;
    this.address = "127.0.0.1";

    this.socket = dgram.createSocket("udp4");
    this.setupListeners();
  }

  public setupListeners() {
    return new Promise((resolve, reject) => {
      try {
        this.socket.bind(
          {
            port: this.port,
            address: this.address,
          },
          () => resolve(null),
        );
      } catch (error) {
        reject(error);
      }
    });
  }

  public sendMessage = async <T extends MessagePayload<UDPDataInfo>>(
    message: Message<T>,
    callback?: (params: any, resolve: (value?: unknown) => void, reject: (reason?: any) => void) => void,
  ): Promise<number[] | undefined> => {
    try {
      const nodeResponse = new Promise<number[]>((resolve, reject) => {
        const payload = JSON.stringify({ ...message });
        const recipient = Number(message.to.address);

        this.socket.send(payload, recipient, this.address, () => {
          const args = { type: message.type, data: message.data, responseId: message.data.data.resId };
          callback(args, resolve, reject);
        });
      });
      const error = new Error("send timeout");
      return Promise.race([nodeResponse, timeoutReject<number[]>(error)]);
    } catch (error) {
      console.error(`message: ${extractError(error)}, fn: sendMessage UDPTransport`);
      return [] as number[];
    }
  };

  public onMessage(callback: (msg: Buffer, info: dgram.RemoteInfo) => Promise<void>) {
    this.socket.on("message", (message, remoteInfo) => {
      callback(message, remoteInfo);
    });
  }

  public close() {
    this.socket.removeAllListeners("message");
    this.socket.close();
  }
}

export default UDPTransport;
