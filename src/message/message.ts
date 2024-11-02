import { MessageType, Transports } from "./types";

export type MessageNode = {
	address: string;
	nodeId: number;
};

export type PayloadInfo = { recipient: number; sender: number };
export type UDPDataInfo = {
	resId: string;
	closestNodes?: number[];
};
export type MessagePayload<T> = {
	description: string;
	type: MessageType;
	data: T;
};

export class Message<T> {
	public readonly from: MessageNode;
	public readonly to: MessageNode;
	public readonly protocol: Transports;
	public readonly data: T;
	public readonly type: MessageType;

	constructor(
		fromPort: string,
		toPort: string,
		fromNodeId: number,
		toNodId: number,
		protocol: Transports,
		data: T,
		type: MessageType,
	) {
		this.from = {
			address: fromPort,
			nodeId: fromNodeId,
		};
		this.to = {
			address: toPort,
			nodeId: toNodId,
		};
		this.protocol = protocol;
		this.data = data;
		this.type = type;
	}

	static create<T>(
		fromPort: string,
		toPort: string,
		fromNodeId: number,
		toNodId: number,
		protocol: Transports,
		data: T,
		type: MessageType,
	): Message<T> {
		const msg = new Message<T>(fromPort, toPort, fromNodeId, toNodId, protocol, data, type);
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
