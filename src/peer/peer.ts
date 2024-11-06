export type PeerJSON = {
	nodeId: number;
	address: string;
	port: number;
	lastSeen: number;
};

export class Peer {
	public readonly nodeId: number;
	public readonly address: string;
	public readonly port: number;

	public lastSeen: number;

	constructor(nodeId: number, address: string, port: number, lastSeen?: number) {
		this.nodeId = nodeId;
		this.port = port;
		this.address = address;
		this.lastSeen = lastSeen ?? Date.now();
	}

	public updateLastSeen = () => {
		this.lastSeen = Date.now();
	};

	public getIsNodeStale = () => {
		return Boolean(this.lastSeen > 35000);
	};

	public static fromJSON = (nodeId: number, address: string, port: number, lastSeen: number): Peer => {
		return new Peer(nodeId, address, port, lastSeen);
	};

	public toJSON = (): PeerJSON => {
		return {
			nodeId: this.nodeId,
			address: this.address,
			port: this.port,
			lastSeen: this.lastSeen,
		};
	};
}
