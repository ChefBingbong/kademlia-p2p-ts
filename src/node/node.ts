import * as dgram from "dgram";
import { v4 } from "uuid";
import { Logger } from "winston";
import { WebSocket } from "ws";
import { JobExecutor } from "../discoveryScheduler/discExecutor";
import { DiscoveryScheduler, SchedulerInfo } from "../discoveryScheduler/discoveryScheduler";
import { App } from "../http/app";
import { AppLogger } from "../logging/logger";
import { Message, MessageNode, MessagePayload, UDPDataInfo } from "../message/message";
import { MessageType, PacketType, Transports } from "../message/types";
import RoutingTable from "../routingTable/routingTable";
import WebSocketTransport from "../transports/tcp/wsTransport";
import { BroadcastData, DirectData, TcpPacket } from "../transports/types";
import UDPTransport from "../transports/udp/udpTransport";
import { extractError } from "../utils/extractError";
import { extractNumber, getIdealDistance } from "../utils/nodeUtils";
import { ALPHA, BIT_SIZE } from "./constants";
import { P2PNetworkEventEmitter } from "./eventEmitter";

class KademliaNode extends AppLogger {
	public readonly address: string;
	public readonly port: number;
	public readonly nodeId: number;
	public readonly nodeContact: MessageNode & { ip: string };

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

		this.nodeContact = {
			address: this.port.toString(),
			nodeId: this.nodeId,
			ip: this.address,
		};

		this.discInitComplete = false;
		this.connections = new Map();

		this.udpTransport = new UDPTransport(this.nodeId, this.port);
		this.wsTransport = new WebSocketTransport(this.nodeId, this.port);

		this.emitter = new P2PNetworkEventEmitter(false);
		this.emitter.on.bind(this.emitter);
		this.emitter.off.bind(this.emitter);

		const jobId = "discScheduler";
		const schedule = "*/20 * * * * *";
		const timestamp = Date.now();
		const info: SchedulerInfo = {
			start: timestamp,
			chnageTime: timestamp + 120000,
		};

		this.discScheduler = new DiscoveryScheduler({
			jobId,
			schedule,
			process,
			info,
		});
		this.api = new App(this, this.port - 1000);
		this.table = new RoutingTable(this.nodeId, this);

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
		await this.table.updateTables([...clostest]);
		await this.initDiscScheduler();
	}

	public async initDiscScheduler() {
		this.discScheduler.createSchedule(this.discScheduler.schedule, async () => {
			try {
				await JobExecutor.addToQueue(`${this.discScheduler.jobId}-${this.port}`, async () => {
					const timestamp = Date.now();

					if (timestamp > this.discScheduler.info.chnageTime && !this.discInitComplete) {
						this.discScheduler.setSchedule("*/30 * * * * *");
						this.discScheduler.stopCronJob();
						this.discInitComplete = true;

						await this.initDiscScheduler();
						console.log(`${this.port} initialized new cron for discovery interval ${timestamp}`);
					}

					const closeNodes = await this.findNodes(this.nodeId);
					await this.table.updateTables(closeNodes);
					const routingPeers = this.table.getAllPeers();

					for (const closestNode of routingPeers) {
						if (!this.wsTransport.connections.has(closestNode.toString()) && this.nodeId !== closestNode) {
							this.wsTransport.connect(closestNode + 3000, () => {
								console.log(`Connection from ${this.nodeId} to ${closestNode + 3000} established.`);
							});
						}
					}
				});
			} catch (error) {
				this.log.error(`message: ${extractError(error)}, fn: executeCronTask`);
			}
		});
	}

	private findNodes = async (key: number): Promise<number[]> => {
		let iteration: number;
		const contacted = new Map<string, number>();

		const shortlist = this.table.findNode(key, ALPHA);
		await this.findNodeRecursiveSearch(contacted, shortlist, shortlist[0], iteration);

		return Array.from(contacted.values());
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
		contactedNodes: Map<string, number>,
		nodeShortlist: number[],
		initialClosestNode: number,
		iteration: number,
	) => {
		const findNodePromises: Array<Promise<boolean>> = [];

		iteration = iteration == null ? 0 : iteration + 1;
		const alphaContacts = nodeShortlist.slice(iteration * ALPHA, iteration * ALPHA + ALPHA);

		for (const node of nodeShortlist) {
			if (contactedNodes.has(node.toString())) {
				continue;
			}
			const recipient = { address: (node + 3000).toString(), nodeId: node };
			const payload = this.buildMessagePayload<UDPDataInfo>(MessageType.PeerDiscovery, { resId: v4() }, this.nodeId);
			const message = this.createUdpMessage<UDPDataInfo>(recipient, MessageType.FindNode, payload);

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
				const recipient = {
					address: packet.destination,
					nodeId: Number(packet.message.to) - 3000,
				};
				const message = this.createTcpMessage<T>(recipient, MessageType.DirectMessage, packet);
				this.wsTransport.sendMessage<T>(message);
				break;
			}
			case MessageType.Braodcast: {
				const packet = this.buildPacket<T>(type, payload);
				const recipient = {
					address: packet.destination,
					nodeId: Number(packet.message.to) - 3000,
				};
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
			const message = JSON.parse(msg.toString()) as Message<MessagePayload<UDPDataInfo>>;
			const externalContact = message.from.nodeId;
			await this.table.updateTables(externalContact);

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
					const recipient = {
						address: message.from.address,
						nodeId: message.from.nodeId,
					};

					this.udpTransport.messages.FIND_NODE.set(message.data.data.resId, message);
					const messagePayload = this.buildMessagePayload<UDPDataInfo>(
						MessageType.PeerDiscovery,
						data,
						externalContact,
					);
					const payload = this.createUdpMessage<UDPDataInfo>(recipient, MessageType.Reply, messagePayload);
					await this.udpTransport.sendMessage<MessagePayload<UDPDataInfo>>(payload, this.udpMessageResolver);
					break;
				}
				case MessageType.FindValue:
					const result = await this.table.findValue(message.data.data.resId);
					// TO-D-
					break;
				case MessageType.Pong:
					// TO-DO
					break;
				case MessageType.Store:
					await this.table.nodeStore<MessagePayload<UDPDataInfo>>(message, info);
					const recip = {
						address: message.from.address,
						nodeId: message.from.nodeId,
					};

					const msgPayload = this.buildMessagePayload<UDPDataInfo>(
						MessageType.PeerDiscovery,
						{ resId: message.data.data.resId },
						externalContact,
					);
					const msg = this.createUdpMessage<UDPDataInfo>(recip, MessageType.Reply, msgPayload);
					await this.udpTransport.sendMessage<MessagePayload<UDPDataInfo>>(msg, this.udpMessageResolver);
					break;
				case MessageType.Ping:
					const recipient = {
						address: message.from.address,
						nodeId: message.from.nodeId,
					};
					this.udpTransport.messages.PING.set(message.data.data.resId, message);

					const messagePayload = this.buildMessagePayload<UDPDataInfo>(
						MessageType.Pong,
						{ resId: message.data.data.resId },
						externalContact,
					);
					const payload = this.createUdpMessage<UDPDataInfo>(recipient, MessageType.Pong, messagePayload);
					await this.udpTransport.sendMessage<MessagePayload<UDPDataInfo>>(payload, this.udpMessageResolver);
					break;

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
			resolve(data.closestNodes);
		});
	};

	private handleBroadcastMessage = async () => {
		console.log(`recieveing broadcasting message: ${this.port}`);
	};

	private handleDirectMessage = async () => {
		console.log(`recieving direct message: ${this.port}`);
	};

	public createUdpMessage = <T>(to: MessageNode, type: MessageType, data: MessagePayload<T>) => {
		const { address: toPort, nodeId: toNodeId } = to;
		return Message.create<MessagePayload<T>>(this.port.toString(), toPort, this.nodeId, toNodeId, Transports.Udp, data, type);
	};

	protected createTcpMessage = <T extends BroadcastData | DirectData>(
		to: MessageNode,
		type: MessageType,
		data: TcpPacket<T>,
	) => {
		const { address: toPort, nodeId: toNodeId } = to;
		return Message.create<TcpPacket<T>>(this.port.toString(), toPort, this.nodeId, toNodeId, Transports.Tcp, data, type);
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

	private handleTcpDisconnet = async (nodeId: number) => {
		if (this.nodeId === nodeId) return;
		const bucket = this.table.findBucket(nodeId);
		bucket.removeNode(nodeId);

		if (bucket.nodes.length === 0) this.table.removeBucket(nodeId);
	};
}

export default KademliaNode;
