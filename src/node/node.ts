import * as dgram from "dgram";
import { v4 } from "uuid";
import { DiscoveryScheduler, Schedules } from "../discoveryScheduler/discoveryScheduler";
import { App } from "../http/app";
import { Message, MessagePayload, UDPDataInfo } from "../message/message";
import { Peer, PeerJSON } from "../peer/peer";
import RoutingTable from "../routingTable/routingTable";
import WebSocketTransport from "../transports/tcp/wsTransport";
import UDPTransport from "../transports/udp/udpTransport";
import { MessageType, PacketType, Transports } from "../types/messageTypes";
import { BroadcastData, DirectData, TcpPacket } from "../types/udpTransportTypes";
import { extractError } from "../utils/extractError";
import { chunk, extractNumber, getIdealDistance, hashKeyAndmapToKeyspace } from "../utils/nodeUtils";
import AbstractNode from "./abstractNode/abstractNode";
import { ALPHA, BIT_SIZE } from "./constants";

class KademliaNode extends AbstractNode {
	public readonly nodeContact: Peer;
	public readonly table: RoutingTable;
	public readonly contacted = new Map<string, number>();
	public readonly api: App;

	public readonly udpTransport: UDPTransport;
	public readonly wsTransport: WebSocketTransport;

	private readonly discScheduler: DiscoveryScheduler;
	public discInitComplete: boolean;

	constructor(id: number, port: number) {
		super(id, port, "kademlia");

		this.discInitComplete = false;
		this.nodeContact = new Peer(this.nodeId, this.address, this.port);
		this.discScheduler = new DiscoveryScheduler({ jobId: "discScheduler" });

		this.udpTransport = new UDPTransport(this.nodeId, this.port);
		this.wsTransport = new WebSocketTransport(this.nodeId, this.port);

		this.api = new App(this, this.port - 1000);
		this.table = new RoutingTable(this.nodeId, this);

		this.listen();
	}

	// register transport listeners
	public listen = (cb?: any): ((cb?: any) => void) => {
		this.udpTransport.onMessage(this.handleMessage);
		this.wsTransport.onMessage(this.handleBroadcastMessage, PacketType.Broadcast);
		this.wsTransport.onMessage(this.handleDirectMessage, PacketType.Direct);

		this.wsTransport.onPeerDisconnect(this.handleTcpDisconnet);
		this.wsTransport.onPeerConnection(() => null);
		this.api.listen();

		return (cb) => this.wsTransport.server.close(cb);
	};

	// node start function
	public start = async () => {
		const clostest = getIdealDistance();
		await this.table.updateTables(clostest);
		await this.initDiscScheduler();
	};

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
						// await this.setDiscoveryInterval(Schedules.Slow);
					} else if (!isNteworkEstablished && this.discScheduler.schedule === Schedules.Slow) {
						// await this.setDiscoveryInterval(Schedules.Fast);
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

	public async store(key: number, value: string) {
		const closestNodes = await this.findNodes(this.nodeId);
		const closestNodesChunked = chunk<Peer>(closestNodes, ALPHA);

		for (const nodes of closestNodesChunked) {
			try {
				const promises = nodes.map((node) => {
					const recipient = new Peer(node.nodeId, this.address, node.port);
					const payload = this.buildMessagePayload<UDPDataInfo & { key: number; value: string }>(
						MessageType.Store,
						{ resId: v4(), key: key, value },
						node.nodeId,
					);
					const message = this.createUdpMessage<UDPDataInfo>(recipient, MessageType.Store, payload);
					return this.udpTransport.sendMessage<MessagePayload<UDPDataInfo>>(message, this.udpMessageResolver);
				});

				return await Promise.all(promises);
			} catch (e) {
				console.error(e);
			}
		}
	}

	public async findValue(value: string) {
		const key = hashKeyAndmapToKeyspace(value);
		const closestNodes = await this.findNodes(key);
		const closestNodesChunked = chunk<Peer>(closestNodes, ALPHA);

		for (const nodes of closestNodesChunked) {
			try {
				const promises = nodes.map((node) => {
					const recipient = new Peer(node.nodeId, this.address, node.port);
					const payload = this.buildMessagePayload<UDPDataInfo & { key: number; value: string }>(
						MessageType.FindValue,
						{ resId: v4(), key, value: value, closestNodes },
						node.nodeId,
					);
					const message = this.createUdpMessage<UDPDataInfo>(recipient, MessageType.FindValue, payload);
					return this.udpTransport.sendMessage<MessagePayload<UDPDataInfo>>(message, this.udpMessageResolver);
				});

				const resolved = await Promise.all(promises);
				for await (const result of resolved) {
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

	public handleMessage = async (msg: Buffer, info: dgram.RemoteInfo) => {
		try {
			const message = JSON.parse(msg.toString()) as Message<MessagePayload<UDPDataInfo & { key?: string; value?: string }>>;
			const externalContact = message.from.nodeId;
			await this.table.updateTables(new Peer(externalContact, this.address, externalContact + 3000));

			switch (message.type) {
				case MessageType.Reply: {
					this.udpTransport.messages.REPLY.set(message.data.data.resId, message);

					const closestNodes = [];
					const key = message.data.data?.key;
					const value = message.data.data?.value;
					const resId = message.data.data.resId;

					if (value) this.emitter.emit(`response_reply2_${resId}`, { value, error: null });
					this.emitter.emit(`response_reply_${resId}`, { closestNodes, key, value, error: null });
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
					this.emitter.emit(`response_pong_${resId}`, { error: null });
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
						const msgPayload = this.buildMessagePayload<UDPDataInfo & { key: string; value: string }>(
							MessageType.Reply,
							{
								resId: message.data.data.resId,
								key: message.data.data?.key,
								value: message.data.data?.value,
								closestNodes: message.data.data.closestNodes,
							},
							externalContact,
						);
						const msg = this.createUdpMessage<UDPDataInfo>(recipient, MessageType.Reply, msgPayload);
						await this.udpTransport.sendMessage<MessagePayload<UDPDataInfo>>(msg, this.udpMessageResolver);
					} else {
						const recipient = Peer.fromJSON(
							message.from.nodeId,
							message.from.address,
							message.from.port,
							message.from.lastSeen,
						);
						const msgPayload = this.buildMessagePayload<UDPDataInfo & { key: string; value: string }>(
							MessageType.Reply,
							{
								resId: message.data.data.resId,
								key: message.data.data?.key,
								value: message.data.data?.value,
								closestNodes: message.data.data.closestNodes,
							},
							externalContact,
						);
						const msg = this.createUdpMessage<UDPDataInfo>(recipient, MessageType.Reply, msgPayload);
						await this.udpTransport.sendMessage<MessagePayload<UDPDataInfo>>(msg, this.udpMessageResolver);
					}

					break;
				}
				case MessageType.Store: {
					await this.table.nodeStore<MessagePayload<UDPDataInfo & { key?: string; value?: string }>>(
						message.data.data?.key,
						message.data.data?.value,
					);
					const recipient = Peer.fromJSON(
						message.from.nodeId,
						message.from.address,
						message.from.port,
						message.from.lastSeen,
					);

					const msgPayload = this.buildMessagePayload<UDPDataInfo & { key?: string; value?: string }>(
						MessageType.Reply,
						{ resId: message.data.data.resId, key: message.data.data?.key, value: message.data.data?.value },
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

		this.emitter.once(`response_reply_${responseId}`, (data: any) => {
			if (data.error) {
				return reject(data.error);
			}
			const nodes = data.closestNodes.map((n: PeerJSON) => Peer.fromJSON(n.nodeId, this.address, n.port, n.lastSeen));
			resolve(nodes);
		});

		this.emitter.once(`response_reply2_${responseId}`, (data: any) => {
			if (data.error) {
				return reject(data.error);
			}
			resolve(data);
		});

		this.emitter.once(`response_pong_${responseId}`, (data: any) => {
			if (data.error) {
				return reject(data.error);
			}
			resolve(data);
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

	private updatePeerDiscoveryInterval = async (isEstablished: boolean) => {
		const currentSchedule = this.discScheduler.schedule;
		const newSchedule = this.discScheduler.getNewSchedule(isEstablished);

		if (newSchedule !== currentSchedule) {
			this.discScheduler.setSchedule(newSchedule);
			this.discScheduler.stopCronJob();
			await this.initDiscScheduler();
			console.log(`setting disc interval to ${newSchedule}`);
		}
	};

	private connectToNewPeers = async (peers: Peer[]) => {
		for (const peer of peers) {
			const peerId = peer.nodeId.toString();
			if (this.wsTransport.connections.has(peerId)) continue;

			this.wsTransport.connect(peer.port, () => {
				console.log(`Connected from ${this.nodeId} to ${peer.port}.`);
			});
		}
	};
}

export default KademliaNode;
