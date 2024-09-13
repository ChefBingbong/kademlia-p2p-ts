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
		callback?: () => Promise<void>,
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
					resolve(callback());
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

	public onMessage(callback: (message: string, remoteInfo: dgram.RemoteInfo) => void) {
		this.socket.on("message", (message, remoteInfo) => {
			callback(message.toString(), remoteInfo);
		});
	}

	public close() {
		this.socket.removeAllListeners("message");
		this.socket.close();
	}
}

export default UDPTransport;
