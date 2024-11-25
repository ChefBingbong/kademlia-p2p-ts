import dgram from "dgram";
import { pack } from "msgpackr";
import { Message, MessagePayload, UDPDataInfo } from "../../message/message";
import { Peer } from "../../peer/peer";
import { MessageType } from "../../types/messageTypes";
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
	): Promise<Peer[] | undefined> => {
		try {
			const nodeResponse = new Promise<Peer[]>((resolve, reject) => {
				const payload = pack(message);
				this.server.send(payload, message.to.port, this.address, () => {
					const args = { type: message.type, data: message.data, responseId: message.data.data.resId };
					callback(args, resolve, reject);
				});
			});
			const error = new Error(`TIMEOUT: ${message.to.port} ${message.type}`);
			return Promise.race([nodeResponse, timeoutReject<Peer[]>(error)]);
		} catch (error) {
			this.log.error(`message: ${extractError(error)}, fn: sendMessage UDPTransport`);
			return [] as Peer[];
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
