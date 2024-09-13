import { Server, WebSocket } from "ws";
// import { Neighbours } from "../contacts/contacts";
// import { IContact } from "../contacts/types";
import { Listener, P2PNetworkEventEmitter } from "../../node/eventEmitter";
import { ErrorWithCode, ProtocolError } from "../../utils/errors";

type NodeID = string; // Node ID as a string, typically represented as a hexadecimal string
type Contact = { nodeId: NodeID; ip: string; port: number };

class WebSocketTransport {
	public readonly connections: Map<string, WebSocket>;
	public readonly nodeId: number;
	public readonly port: number;
	public readonly ports: number[];
	public readonly neighbors: Map<string, string>;

	public on: (event: string, listener: (...args: any[]) => void) => void;
	public off: (event: string, listener: (...args: any[]) => void) => void;

	private readonly emitter: P2PNetworkEventEmitter;
	private isInitialized: boolean = false;
	private server: Server;

	constructor(nodeId: number, port: number, ports: number[]) {
		this.connections = new Map();
		this.neighbors = new Map();

		this.nodeId = nodeId;
		this.port = port;
		this.ports = ports;

		this.server = new WebSocket.Server({ port });
		this.emitter = new P2PNetworkEventEmitter(false);
		this.emitter.on.bind(this.emitter);
		this.emitter.off.bind(this.emitter);

		this.on = (e: string, l: Listener) => this.emitter.on(e, l);
		this.off = (e: string, l: Listener) => this.emitter.on(e, l);
		this.setupListeners();
	}

	private setupListeners = (): void => {
		this.on("_connect", (connectionId) => {
			this.sendMessage(connectionId.connectionId, {
				type: "handshake",
				data: { nodeId: this.nodeId },
			});
		});

		this.on("connect", async ({ nodeId }: { nodeId: string }) => {
			console.log(`New node connected: ${nodeId}`);
			this.handlePeerConnection();
		});

		this.on("_message", async ({ connectionId, message }) => {
			const { type, data } = message;
			console.log(connectionId, message);
			if (type === "handshake") {
				this.neighbors.set(connectionId, connectionId);
				this.emitter.emitConnect(data.nodeId, true);
			}

			if (type === "message") {
				this.emitter.emitMessage(connectionId, data, true);
			}
		});

		this.on("_disconnect", (connectionId) => {
			this.neighbors.delete(connectionId);
			this.emitter.emitDisconnect(connectionId, true);
		});

		this.on("disconnect", async ({ nodeId }: { nodeId: string }) => {
			console.log(`Node disconnected: ${nodeId}`);
			this.handlePeerDisconnect();
		});

		this.on("message", (message) => {
			this.handlePeerMessage(() => message);
		});

		this.isInitialized = true;
	};

	public listen(cb?: () => void): (cb?: any) => void {
		if (!this.isInitialized)
			throw new ErrorWithCode(
				`Cannot listen before server is initialized`,
				ProtocolError.PARAMETER_ERROR,
			);

		const ports = [this.port, ...this.ports];

		ports.forEach((p) => {
			const socket = new WebSocket(`ws://localhost:${p}`);

			socket.on("open", async () => {
				this.handleNewConnection(socket, p - 3000, () => {
					console.log(`Connection to ${p} established.`);
				});
			});
		});

		this.server.on("connection", (socket) => {
			this.handleNewConnection(socket, this.nodeId, () => {
				console.log(`Connection to ${this.port} established.`);
			});
		});

		return (cb) => this.server.close(cb);
	}

	private handlePeerMessage = async (callback?: () => Promise<void>) => {
		await callback?.();
	};

	private handlePeerConnection = async (callback?: () => Promise<void>) => {
		await callback?.();
	};

	private handlePeerDisconnect = async (callback?: () => Promise<void>) => {
		await callback?.();
	};

	public handleNewConnection = (socket: WebSocket, nodeId: number, callback?: () => void) => {
		const connectionId = nodeId.toString();

		this.connections.set(connectionId, socket);
		this.emitter.emitConnect(connectionId, false);

		socket.on("message", (message: any) => {
			const receivedData = JSON.parse(message);
			this.emitter.emitMessage(connectionId, receivedData, false);
		});

		socket.on("close", () => {
			this.connections.delete(connectionId);
			this.emitter.emitDisconnect(connectionId, false);
		});

		socket.on("error", (err) => {
			console.error(`Socket connection error: ${err.message}`);
		});

		return () => socket.terminate();
	};

	public sendMessage = (connectionId: string, message: any) => {
		const socket = this.connections.get(connectionId);
		if (!socket)
			throw new ErrorWithCode(
				`Attempt to send data to connection that does not exist ${connectionId}`,
				ProtocolError.INTERNAL_ERROR,
			);

		socket.send(JSON.stringify(message));
	};
}

export default WebSocketTransport;
