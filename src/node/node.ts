import * as dgram from "dgram";
import { v4 } from "uuid";
import { Logger } from "winston";
import { WebSocket } from "ws";
import { DiscoveryScheduler, Schedules } from "../discoveryScheduler/discoveryScheduler";
import { App } from "../http/app";
import { AppLogger } from "../logging/logger";
import { Message, MessagePayload, UDPDataInfo } from "../message/message";
import { Peer, PeerJSON } from "../peer/peer";
import RoutingTable from "../routingTable/routingTable";
import WebSocketTransport from "../transports/tcp/wsTransport";
import UDPTransport from "../transports/udp/udpTransport";
import { MessageType, PacketType, Transports } from "../types/messageTypes";
import { BroadcastData, DirectData, TcpPacket } from "../types/udpTransportTypes";
import { extractError } from "../utils/extractError";
import { chunk, extractNumber, getIdealDistance } from "../utils/nodeUtils";
import { ALPHA, BIT_SIZE } from "./constants";
import { P2PNetworkEventEmitter } from "./eventEmitter";

class KademliaNode extends AppLogger {
	public readonly address: string;
	public readonly port: number;
	public readonly nodeId: number;
	public readonly nodeContact: Peer;

	public readonly table: RoutingTable;
	public readonly api: App;
	public readonly log: Logger;

	public readonly contacted = new Map<string, number>();
	public readonly connections: Map<string, WebSocket>;

	public readonly udpTransport: UDPTransport;
	public readonly wsTransport: WebSocketTransport;
	private readonly discScheduler: DiscoveryScheduler;
	private readonly emitter: P2PNetworkEventEmitter;

	public discInitComplete: boolean;

	constructor(id: number, port: number) {
		super("kademlia-node-logger", false);

		this.nodeId = id;
		this.port = port;
		this.address = "127.0.0.1";
		this.log = this.logger;
		this.discInitComplete = false;
		this.connections = new Map();

		this.nodeContact = new Peer(this.nodeId, this.address, this.port);
		this.udpTransport = new UDPTransport(this.nodeId, this.port);
		this.wsTransport = new WebSocketTransport(this.nodeId, this.port);

		this.emitter = new P2PNetworkEventEmitter(false);
		this.emitter.on.bind(this.emitter);
		this.emitter.off.bind(this.emitter);

		this.api = new App(this, this.port - 1000);
		this.table = new RoutingTable(this.nodeId, this);

		this.discScheduler = new DiscoveryScheduler({
			jobId: "discScheduler",
			schedule: Schedules.Fast,
			process,
		});

		this.api.listen();
		this.listen();
	}

	public listen(): (cb?: any) => void {
		this.udpTransport.onMessage(this.handleMessage);
		this.wsTransport.onMessage(this.handleBroadcastMessage, PacketType.Broadcast);
		this.wsTransport.onMessage(this.handleDirectMessage, PacketType.Direct);

		this.wsTransport.onPeerDisconnect(this.handleTcpDisconnet);
		this.wsTransport.onPeerConnection(() => null);

		return (cb) => this.wsTransport.server.close(cb);
	}

	public async start() {
		const clostest = getIdealDistance();
		await this.table.updateTables(clostest);
		await this.initDiscScheduler();
	}

	public async initDiscScheduler() {
		this.discScheduler.createSchedule(this.discScheduler.schedule, async () => {
			try {
				const closeNodes = await this.findNodes(this.nodeId);
				await this.table.updateTables(closeNodes);

				const routingPeers = this.table.getAllPeers();
				const numBuckets = Object.values(this.table.getAllBuckets()).length;

				const minPeers = Boolean(routingPeers.length >= BIT_SIZE * 2 - BIT_SIZE / 2);
				const isNteworkEstablished = Boolean(minPeers && numBuckets === BIT_SIZE);

				if (this.discInitComplete) {
					if (isNteworkEstablished && this.discScheduler.schedule === Schedules.Fast) {
						await this.setDiscoveryInterval(Schedules.Slow);
					} else if (!isNteworkEstablished && this.discScheduler.schedule === Schedules.Slow) {
						await this.setDiscoveryInterval(Schedules.Fast);
					}
				}
				for (const closestNode of routingPeers) {
					if (Date.now() > closestNode.lastSeen + 60000 && this.nodeId !== closestNode.nodeId) {
						const connection = this.wsTransport.connections.get(closestNode.nodeId.toString());
						if (connection) {
							await connection.close();
							this.wsTransport.connections.delete(closestNode.nodeId.toString());
							this.wsTransport.neighbors.delete(closestNode.nodeId.toString());
						}
					}
					if (!this.wsTransport.connections.has(closestNode.nodeId.toString())) {
						this.wsTransport.connect(closestNode.port, () => {
							console.log(`Connection from ${this.nodeId} to ${closestNode.port} established.`);
						});
					}
				}

				this.discInitComplete = true;
			} catch (error) {
				this.log.error(`message: ${extractError(error)}, fn: executeCronTask`);
			}
		});
	}

	private findNodes = async (key: number): Promise<Peer[]> => {
		let iteration: number;
		const contacted = new Map<string, Peer>();

		const shortlist = this.table.findNode(key, ALPHA);
		await this.findNodeRecursiveSearch(contacted, shortlist, shortlist[0], iteration);

		return Array.from(contacted.values());
	};

	private handleFindNodeQuery = async (
		closeNodesResponse: Promise<Peer[]>,
		node: Peer,
		contactedNodes: Map<string, Peer>,
		nodeShortlist: Peer[],
		initialClosestNode: Peer,
	) => {
		let hasCloserThanExist = false;
		try {
			const closeNodes = await closeNodesResponse;
			contactedNodes.set(node.nodeId.toString(), node);

			for (const currentCloseNode of closeNodes) {
				nodeShortlist.push(currentCloseNode);

				const currentDistance = this.table.getBucketIndex(initialClosestNode.nodeId);
				const distance = this.table.getBucketIndex(currentCloseNode.nodeId);

				if (distance < currentDistance) {
					initialClosestNode = currentCloseNode;
					hasCloserThanExist = true;
				}
			}
		} catch (e) {
			const errorMessage = extractError(e);
			console.log(errorMessage);
			if (errorMessage.includes("TIMEOUT")) {
				const nodeId = extractNumber(errorMessage);
				this.handleTcpDisconnet(nodeId);
			}
		}

		return hasCloserThanExist;
	};

	private findNodeRecursiveSearch = async (
		contactedNodes: Map<string, Peer>,
		nodeShortlist: Peer[],
		initialClosestNode: Peer,
		iteration: number,
	) => {
		const findNodePromises: Array<Promise<boolean>> = [];

		iteration = iteration == null ? 0 : iteration + 1;
		const alphaContacts = nodeShortlist.slice(iteration * ALPHA, iteration * ALPHA + ALPHA);

		for (const node of alphaContacts) {
			//need to test this with larger networks vs nodeshrtlost
			if (contactedNodes.has(node.toString())) {
				continue;
			}
			const recipient = node.toJSON();
			const payload = this.buildMessagePayload<UDPDataInfo>(MessageType.PeerDiscovery, { resId: v4() }, recipient.nodeId);
			const message = this.createUdpMessage<UDPDataInfo>(recipient, MessageType.FindNode, payload);

			// console.log(message);
			const findNodeResponse = this.udpTransport.sendMessage<MessagePayload<UDPDataInfo>>(message, this.udpMessageResolver);
			findNodePromises.push(
				this.handleFindNodeQuery(findNodeResponse, node, contactedNodes, nodeShortlist, initialClosestNode),
			);
		}

		if (!findNodePromises.length) {
			console.log("No more contacts in shortlist");
			return;
		}

		const results = await Promise.all(findNodePromises);
		const isUpdatedClosest = results.some(Boolean);

		if (isUpdatedClosest && contactedNodes.size < BIT_SIZE) {
			await this.findNodeRecursiveSearch(contactedNodes, nodeShortlist, initialClosestNode, iteration);
		}
	};

	public async store(key: number, block: string) {
		const closestNodes = await this.findNodes(this.nodeId);
		const closestNodesChunked = chunk<Peer>(closestNodes, ALPHA);

		for (const nodes of closestNodesChunked) {
			try {
				const promises = nodes.map((node) => {
					const recipient = new Peer(node.nodeId, this.address, node.port);
					const payload = this.buildMessagePayload<UDPDataInfo & { key: number; block: string }>(
						MessageType.Store,
						{ resId: v4(), key: key, block },
						node.nodeId,
					);
					const message = this.createUdpMessage<UDPDataInfo>(recipient, MessageType.Store, payload);
					return this.udpTransport.sendMessage<MessagePayload<UDPDataInfo>>(message, this.udpMessageResolver);
				});

				await Promise.all(promises);
			} catch (e) {
				console.error(e);
			}
		}
	}

	public async findValue(key: number) {
		const closestNodes = await this.findNodes(Number(key));
		const closestNodesChunked = chunk<Peer>(closestNodes, ALPHA);

		for (const nodes of closestNodesChunked) {
			try {
				const promises = nodes.map((node) => {
					const recipient = new Peer(node.nodeId, this.address, node.port);
					const payload = this.buildMessagePayload<UDPDataInfo & { key: number }>(
						MessageType.FindValue,
						{ resId: v4(), key },
						node.nodeId,
					);
					const message = this.createUdpMessage<UDPDataInfo>(recipient, MessageType.FindValue, payload);
					return this.udpTransport.sendMessage<MessagePayload<UDPDataInfo>>(message, this.udpMessageResolver);
				});

				for await (const result of promises) {
					// if (typeof result === "string") {
					return result;
					// }
				}
			} catch (e) {
				console.error(e);
			}
		}
	}

	public getTransportMessages = (transport: Transports, type: MessageType) => {
		switch (transport) {
			case Transports.Tcp:
				return this.wsTransport.messages[type];
			case Transports.Udp:
				return this.udpTransport.messages[type];
			default:
				this.log.error("No messages for this transport or type");
		}
	};

	public sendTcpTransportMessage = <T extends BroadcastData | DirectData>(type: MessageType, payload: T) => {
		switch (type) {
			case MessageType.DirectMessage: {
				const packet = this.buildPacket<T>(type, payload);
				const recipient = new Peer(Number(packet.message.to) - 3000, this.address, Number(packet.destination));
				const message = this.createTcpMessage<T>(recipient, MessageType.DirectMessage, payload);
				this.wsTransport.sendMessage<T>(message);
				break;
			}
			case MessageType.Braodcast: {
				const packet = this.buildPacket<T>(type, payload);
				const recipient = new Peer(Number(packet.message.to) - 3000, this.address, Number(packet.destination));
				const message = this.createTcpMessage<T>(recipient, MessageType.Braodcast, packet);
				this.wsTransport.sendMessage<T>(message);
				break;
			}
			default:
				this.log.error("Message type does not exist");
		}
	};

	private handleMessage = async (msg: Buffer, info: dgram.RemoteInfo) => {
		try {
			const message = JSON.parse(msg.toString()) as Message<MessagePayload<UDPDataInfo & { key?: string; block?: string }>>;
			const externalContact = message.from.nodeId;
			await this.table.updateTables(new Peer(externalContact, this.address, externalContact + 3000));

			switch (message.type) {
				case MessageType.Reply: {
					this.udpTransport.messages.REPLY.set(message.data.data.resId, message);

					const closestNodes = message.data.data.closestNodes;
					const resId = message.data.data.resId;

					this.emitter.emit(`response_${resId}`, { closestNodes, error: null });
					break;
				}
				case MessageType.FindNode: {
					const closestNodes = this.table.findNode(externalContact);
					const data = { resId: message.data.data.resId, closestNodes };
					this.udpTransport.messages.FIND_NODE.set(message.data.data.resId, message);

					const recipient = Peer.fromJSON(
						message.from.nodeId,
						message.from.address,
						message.from.port,
						message.from.lastSeen,
					);
					const messagePayload = this.buildMessagePayload<UDPDataInfo>(
						MessageType.PeerDiscovery,
						data,
						externalContact,
					);
					const payload = this.createUdpMessage<UDPDataInfo>(recipient, MessageType.Reply, messagePayload);
					await this.udpTransport.sendMessage<MessagePayload<UDPDataInfo>>(payload, this.udpMessageResolver);
					break;
				}
				case MessageType.Pong: {
					const resId = message.data.data.resId;
					this.emitter.emit(`response_${resId}`, { error: null });
					break;
				}
				case MessageType.FindValue: {
					const result = await this.table.findValue(message.data.data.key);
					if (Array.isArray(result)) {
						const recipient = Peer.fromJSON(
							message.from.nodeId,
							message.from.address,
							message.from.port,
							message.from.lastSeen,
						);
						const msgPayload = this.buildMessagePayload<UDPDataInfo & { key: string; block: string }>(
							MessageType.Reply,
							{
								resId: message.data.data.resId,
								key: message.data.data?.key,
								block: message.data.data?.block,
								closestNodes: result,
							},
							externalContact,
						);
						const msg = this.createUdpMessage<UDPDataInfo>(recipient, MessageType.Reply, msgPayload);
						await this.udpTransport.sendMessage<MessagePayload<UDPDataInfo>>(msg, this.udpMessageResolver);
						console.log("array, value", message);
					} else {
						const recipient = Peer.fromJSON(
							message.from.nodeId,
							message.from.address,
							message.from.port,
							message.from.lastSeen,
						);
						const msgPayload = this.buildMessagePayload<UDPDataInfo & { key: string; block: string }>(
							MessageType.Reply,
							{
								resId: message.data.data.resId,
								key: message.data.data?.key,
								block: result,
							},
							externalContact,
						);
						const msg = this.createUdpMessage<UDPDataInfo>(recipient, MessageType.Reply, msgPayload);
						await this.udpTransport.sendMessage<MessagePayload<UDPDataInfo>>(msg, this.udpMessageResolver);
					}

					break;
				}
				case MessageType.Store: {
					await this.table.nodeStore<MessagePayload<UDPDataInfo & { key?: string; block?: string }>>(
						message.data.data?.key,
						message.data.data?.block,
					);
					const recipient = Peer.fromJSON(
						message.from.nodeId,
						message.from.address,
						message.from.port,
						message.from.lastSeen,
					);

					const msgPayload = this.buildMessagePayload<UDPDataInfo>(
						MessageType.Reply,
						{ resId: message.data.data.resId },
						externalContact,
					);
					const msg = this.createUdpMessage<UDPDataInfo>(recipient, MessageType.Reply, msgPayload);
					await this.udpTransport.sendMessage<MessagePayload<UDPDataInfo>>(msg, this.udpMessageResolver);
					break;
				}
				case MessageType.Ping: {
					const recipient = Peer.fromJSON(
						message.from.nodeId,
						message.from.address,
						message.from.port,
						message.from.lastSeen,
					);
					this.udpTransport.messages.PING.set(message.data.data.resId, message);

					const messagePayload = this.buildMessagePayload<UDPDataInfo>(
						MessageType.Pong,
						{ resId: message.data.data.resId },
						externalContact,
					);
					const payload = this.createUdpMessage<UDPDataInfo>(recipient, MessageType.Pong, messagePayload);
					await this.udpTransport.sendMessage<MessagePayload<UDPDataInfo>>(payload, this.udpMessageResolver);
					break;
				}
				default:
					return;
			}
		} catch (e) {
			const errorMessage = extractError(e);
			this.log.error(errorMessage);
		}
	};

	public udpMessageResolver = (params: any, resolve: (value?: unknown) => void, reject: (reason?: any) => void) => {
		const { type, responseId } = params;
		if (type === MessageType.Reply) resolve();
		if (type === MessageType.Pong) resolve();

		this.emitter.once(`response_${responseId}`, (data: any) => {
			if (data.error) {
				return reject(data.error);
			}
			const nodes = data.closestNodes.map((n: PeerJSON) => Peer.fromJSON(n.nodeId, this.address, n.port, n.lastSeen));
			resolve(nodes);
		});
	};

	private handleBroadcastMessage = async () => {
		console.log(`recieveing broadcasting message: ${this.port}`);
	};

	private handleDirectMessage = async () => {
		console.log(`recieving direct message: ${this.port}`);
	};

	public createUdpMessage = <T>(to: PeerJSON, type: MessageType, data: MessagePayload<T>) => {
		const from = this.nodeContact.toJSON();
		return Message.create<MessagePayload<T>>(to, from, Transports.Udp, data, type);
	};

	protected createTcpMessage = <T extends BroadcastData | DirectData>(to: PeerJSON, type: MessageType, payload: any) => {
		const from = this.nodeContact.toJSON();
		const packet = this.buildPacket<T>(type, payload);
		return Message.create<TcpPacket<T>>(to, from, Transports.Tcp, packet, type);
	};

	public buildMessagePayload = <T extends UDPDataInfo>(type: MessageType, data: T, recipient: number): MessagePayload<T> => {
		return {
			description: `${recipient} Recieved Peer discovery ${type} from ${this.nodeId}`,
			type,
			data,
		};
	};

	private buildPacket = <T extends BroadcastData | DirectData>(
		type: MessageType,
		message: any,
		ttl: number = 255,
	): TcpPacket<T> => {
		return {
			id: v4(),
			ttl: ttl,
			type: type === MessageType.Braodcast ? PacketType.Broadcast : PacketType.Direct,
			message,
			destination: message.from,
			origin: this.wsTransport.port.toString(),
		};
	};

	public handleTcpDisconnet = async (nodeId: number) => {
		this.wsTransport.connections.delete(nodeId.toString());
		this.wsTransport.neighbors.delete(nodeId.toString());

		if (this.nodeId === nodeId) return;
		const peer = new Peer(nodeId, this.address, nodeId + 3000);
		const bucket = this.table.findBucket(peer);
		bucket.removeNode(peer);

		if (bucket.nodes.length === 0) this.table.removeBucket(peer);
	};

	private setDiscoveryInterval = async (interval: string) => {
		this.discScheduler.setSchedule(interval);
		this.discScheduler.stopCronJob();
		this.discInitComplete = true;
		await this.initDiscScheduler();
		console.log(`setting disc interval to ${interval}`);
	};
}

export default KademliaNode;
