import { Peer, PeerJSON } from "../peer/peer";
import { MessageType, Transports } from "../types/messageTypes";


export type MessageNode = {
	address: string;
	nodeId: number;
};

export type PayloadInfo = { recipient: number; sender: number };
export type UDPDataInfo = {
	resId: string;
	closestNodes?: Peer[];
};
export type MessagePayload<T> = {
	description: string;
	type: MessageType;
	data: T;
};

export class Message<T> {
	public readonly from: PeerJSON;
	public readonly to: PeerJSON;
	public readonly protocol: Transports;
	public readonly data: T;
	public readonly type: MessageType;

	constructor(to: PeerJSON, from: PeerJSON, protocol: Transports, data: T, type: MessageType) {
		this.from = from;
		this.to = to;
		this.protocol = protocol;
		this.data = data;
		this.type = type;
	}

	static create<T>(to: PeerJSON, from: PeerJSON, protocol: Transports, data: T, type: MessageType): Message<T> {
		const msg = new Message<T>(to, from, protocol, data, type);
		Object.freeze(msg);
		return msg;
	}

	toString(): string {
		return `message: from: ${this.from}, to: ${this.to}, protocol: ${this.protocol}`;
	}

	// TO-DO dont have genric type as any
	static isFor<T extends Message<any> | Message<any>>(id: string, msg: T): boolean {
		if (msg.from.address === id) {
			return false;
		}
		return msg.to.address === "" || msg.to.address === id;
	}
}
