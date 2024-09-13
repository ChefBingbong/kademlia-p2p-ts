import dgram from "dgram";
import { v4 } from "uuid";
import { timeoutReject } from "../../node/utils";

class UDPTransport {
	public readonly address: string;
	public readonly nodeId: number;
	public readonly port: number;

	private socket: dgram.Socket;

	constructor(nodeId: number, port: number) {
		this.nodeId = nodeId;
		this.port = port;
		this.address = "127.0.0.1";

		this.socket = dgram.createSocket("udp4");
		this.setupListeners();
	}

	public setupListeners() {
		return new Promise((res, rej) => {
			try {
				this.socket.bind(
					{
						port: this.port,
						address: this.address,
					},
					() => {
						res(null);
					},
				);
			} catch (err) {
				rej(err);
			}
		});
	}

	public sendMessage = async (
		contact: number,
		type: any,
		data: any,
		resId?: string,
		callback?: (params: any, resolve: (value?: unknown) => void, reject: (reason?: any) => void) => void,
	) => {
		try {
			const nodeResponse = new Promise<any>((resolve, reject) => {
				const responseId = resId ?? v4();
				const message = JSON.stringify({
					type,
					data: data,
					resId: responseId,
					fromNodeId: this.nodeId,
				});
				this.socket.send(message, contact, this.address, () => {
					const args = { type, data, responseId };
					callback(args, resolve, reject);
				});
			});
			const error = new Error("send timeout");
			const result = await Promise.race([nodeResponse, timeoutReject(error)]);
			return result;
		} catch (e) {
			console.log(e);
			return [];
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
