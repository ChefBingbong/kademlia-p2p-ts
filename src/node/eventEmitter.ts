import { EventEmitter } from "events";

export enum P2PNetworkEvents {
	CONNECT = "connect",
	DISCONNECT = "disconnect",
	MESSAGE = "message",
	_CONNECT = "_connect",
	_DISCONNECT = "_disconnect",
	_MESSAGE = "_message",
	BROADCAST = "broadcast",
	DIRECT = "direct",
}

export type Listener = (...args: any[]) => void;
export class P2PNetworkEventEmitter extends EventEmitter {
	constructor(readonly debug: boolean) {
		super();
	}

	emitConnect(nodeId: string, forPeers: boolean = false): void {
		if (this.debug) {
			console.debug(`'${P2PNetworkEvents.CONNECT}'`, nodeId);
		}
		if (forPeers) this.emit(P2PNetworkEvents.CONNECT, { nodeId });
		else this.emit(P2PNetworkEvents._CONNECT, { connectionId: nodeId });
	}

	emitDisconnect(nodeId: string, forPeers: boolean = false): void {
		if (this.debug) {
			console.debug(`'${P2PNetworkEvents.DISCONNECT}'`, nodeId);
		}
		if (forPeers) this.emit(P2PNetworkEvents.DISCONNECT, { nodeId });
		else
			this.emit(P2PNetworkEvents._DISCONNECT, {
				connectionId: nodeId,
			});
	}

	emitMessage(nodeId: string, data: any, forPeers: boolean = false): void {
		if (this.debug) {
			console.debug(`'${P2PNetworkEvents.MESSAGE}'`);
		}
		if (forPeers) this.emit(P2PNetworkEvents.MESSAGE, { nodeId, data });
		else
			this.emit(P2PNetworkEvents._MESSAGE, {
				connectionId: nodeId,
				message: data,
			});
	}

	emitBroadcast(message: any, origin: string): void {
		if (this.debug) {
			console.debug(`'${P2PNetworkEvents.BROADCAST}'`, {
				message,
				origin,
			});
		}
		this.emit(P2PNetworkEvents.BROADCAST, { message, origin });
	}

	emitDirect(message: any, origin: string): void {
		if (this.debug) {
			console.debug(`'${P2PNetworkEvents.DIRECT}'`, {
				message,
				origin,
			});
		}
		this.emit(P2PNetworkEvents.DIRECT, { message, origin });
	}
}
