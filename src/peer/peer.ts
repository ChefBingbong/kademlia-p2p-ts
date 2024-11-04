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

	public fromJSON = () => new Peer(this.nodeId, this.address, this.port);

	public toJSON = () => {
		return {
			nodeId: this.nodeId,
			address: this.address,
			port: this.port,
		};
	};
}
