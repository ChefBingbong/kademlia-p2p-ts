import * as dgram from "dgram";
import { v4 } from "uuid";
import { WebSocket } from "ws";
import { App } from "../http/app";
import RoutingTable from "../routingTable/routingTable";
import WebSocketTransport from "../transports/tcp/wsTransport";
import UDPTransport from "../transports/udp/udpTransport";
import { BIT_SIZE } from "./constants";
// import { Neighbours } from "../contacts/contacts";
// import { IContact } from "../contacts/types";
import { Listener, P2PNetworkEventEmitter } from "./eventEmitter";

type NodeID = string; // Node ID as a string, typically represented as a hexadecimal string
type Contact = { nodeId: NodeID; ip: string; port: number };

class KademliaNode {
	public address: string;
	public port: number;
	public nodeId: number;
	public table: RoutingTable;
	public s = false;
	public api: App;
	private stopDiscovery = false;
	public contacted = new Map<string, number>();
	public seenMessages: Set<string> = new Set();
	public messages = new Map<string, string>();

	public readonly connections: Map<string, WebSocket>;

	public shortlist: number[] = [];
	public currentClosestNode: number;
	public closestNodes: boolean[] = [];

	private readonly emitter: P2PNetworkEventEmitter;
	private udpTransport: UDPTransport;
	private wsTransport: WebSocketTransport;

	on: (event: string, listener: (...args: any[]) => void) => void;
	off: (event: string, listener: (...args: any[]) => void) => void;

	constructor(id: number, port: number) {
		this.nodeId = id;
		this.port = port;
		this.address = "127.0.0.1";
		this.connections = new Map();

		this.udpTransport = new UDPTransport(this.nodeId, this.port);
		this.wsTransport = new WebSocketTransport(this.nodeId, this.port + 1000, []);

		this.api = new App(this, this.port);
		this.table = new RoutingTable(this.nodeId, this);

		this.emitter = new P2PNetworkEventEmitter(false);
		this.emitter.on.bind(this.emitter);
		this.emitter.off.bind(this.emitter);

		this.on = (e: string, l: Listener) => this.emitter.on(e, l);
		this.off = (e: string, l: Listener) => this.emitter.on(e, l);

		this.api.listen();
		this.listen();
	}

	public async start() {
		await this.table.updateTables(0);
		this.startNodeDiscovery();
	}

	public listen() {
		this.udpTransport.onMessage(this.handleMessage);
		this.wsTransport.listen();
	}

	public udpMessageResolver = (
		params: any,
		resolve: (value?: unknown) => void,
		reject: (reason?: any) => void,
	) => {
		const { type, responseId } = params;
		if (type === "REPLY") resolve();
		this.emitter.once(`response_${responseId}`, (data: any) => {
			if (data.error) {
				return reject(data.error);
			}
			resolve(data.closestNodes);
		});
	};

	private handleFindNodeQuery = async (
		closeNodesResponse: Promise<number[]>,
		nodeId: number,
		contactedNodes: Map<string, number>,
		nodeShortlist: number[],
		initialClosestNode: number,
	) => {
		let hasCloserThanExist = false;

		try {
			const closeNodes = await closeNodesResponse;
			contactedNodes.set(nodeId.toString(), nodeId);

			for (const currentCloseNode of closeNodes) {
				nodeShortlist.push(currentCloseNode);

				const currentDistance = this.table.getBucketIndex(initialClosestNode);
				const distance = this.table.getBucketIndex(currentCloseNode);

				if (distance < currentDistance) {
					initialClosestNode = currentCloseNode;
					hasCloserThanExist = true;
				}
			}
		} catch (e) {
			console.error(e);
		}

		return hasCloserThanExist;
	};

	private findNodeRecursiveSearch = async (
		contactedNodes: Map<string, number>,
		nodeShortlist: number[],
		initialClosestNode: number,
	) => {
		const findNodePromises: Array<Promise<boolean>> = [];

		for (const node of nodeShortlist) {
			if (contactedNodes.has(node.toString())) {
				continue;
			}
			const findNodeResponse = this.udpTransport.sendMessage(
				3000 + node,
				"FIND_NODE",
				{},
				undefined,
				this.udpMessageResolver,
			);
			findNodePromises.push(
				this.handleFindNodeQuery(
					findNodeResponse,
					node,
					contactedNodes,
					nodeShortlist,
					initialClosestNode,
				),
			);
		}

		if (!findNodePromises.length) {
			console.log("No more contacts in shortlist");
			return;
		}

		const results = await Promise.all(findNodePromises);
		const isUpdatedClosest = results.some(Boolean);

		if (isUpdatedClosest && contactedNodes.size < BIT_SIZE) {
			await this.findNodeRecursiveSearch(contactedNodes, nodeShortlist, initialClosestNode);
		}
	};
	private findNodes = async (key: number) => {
		const contacted = new Map<string, any>();
		const shortlist = this.table.findNode(key);

		let currentClosestNode = shortlist[0];
		await this.findNodeRecursiveSearch(contacted, shortlist, currentClosestNode);

		return Array.from(contacted.values());
	};

	private handleMessage = async (msg: Buffer, info: dgram.RemoteInfo) => {
		try {
			const message = JSON.parse(msg.toString());
			const externalContact = message.fromNodeId;
			await this.table.updateTables(externalContact);

			switch (message.type) {
				case "REPLY": {
					if (message?.data?.closestNodes) {
						await this.table.updateTables(message.data.closestNodes);

						this.emitter.emit(`response_${message.resId}`, {
							closestNodes: message?.data?.closestNodes,
							error: null,
						});
					}
					break;
				}
				case "FIND_NODE": {
					const closestNodes = this.table.findNode(externalContact);
					await this.udpTransport.sendMessage(
						info.port,
						"REPLY",
						{ closestNodes },
						message.resId,
						this.udpMessageResolver,
					);
					break;
				}

				default:
					return;
			}
		} catch (error) {
			console.error(error);
		}
	};

	private async discoverNodes(): Promise<void> {
		while (!this.stopDiscovery) {
			// this.s = true
			const closeNodes = await this.findNodes(this.nodeId);
			if (!this.s) await this.table.updateTables(closeNodes);
			this.s = true;

			closeNodes.forEach((n) => {
				if (this.wsTransport.connections.has(n.toString())) {
					this.wsTransport.handleNewConnection(
						this.wsTransport.connections.get(n.toString()),
						n,
					);
				}
			});
			await this.sleep(25000);
		}
	}

	public broadcast = (
		message: any,
		id: string = v4(),
		origin: string = this.port.toString(),
		ttl: number = 255,
	) => {
		this.sendPacket({ id, ttl, type: "broadcast", message, origin });
	};

	public sendDirect = (
		destination: string,
		message: any,
		id: string = v4(),
		origin: string = this.port.toString(),
		ttl: number = 255,
	) => {
		this.sendPacket({
			id,
			ttl,
			type: "direct",
			message,
			destination,
			origin,
		});
	};

	private sendPacket = (packet: any) => {
		if (packet.type === "direct") {
			this.sendTCP(packet.destination, packet);
			this.seenMessages.add(packet.id);
		} else {
			for (const $nodeId of this.wsTransport.connections.keys()) {
				this.sendTCP($nodeId, packet);
				this.seenMessages.add(packet.id);
			}
		}
	};

	private sendTCP = (nodeId: string, data: any) => {
		this.wsTransport.sendMessage(nodeId, { type: "message", data });
	};

	private sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	startNodeDiscovery(): void {
		this.stopDiscovery = false;
		this.discoverNodes();
	}

	stopNodeDiscovery(): void {
		this.stopDiscovery = true;
		console.log("Stopping node discovery");
	}
}

export default KademliaNode;
