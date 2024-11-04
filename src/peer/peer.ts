export class Peer {
	public readonly nodeId: number;
	public readonly address: string;
	public readonly port: number;

	public lastSeen: number;

	constructor(nodeId: number, address: string, port: number) {
		this.nodeId = nodeId;
		this.port = port;
		this.address = address;
		this.lastSeen = Date.now();
	}

	public updateLastSeen = () => {
		this.lastSeen = Date.now();
	};
}