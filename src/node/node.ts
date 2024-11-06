import * as dgram from "dgram";
import { isArray } from "mathjs";
import { v4 } from "uuid";
import { DiscoveryScheduler } from "../discoveryScheduler/discoveryScheduler";
import { App } from "../http/app";
import { Message, MessagePayload, UDPDataInfo } from "../message/message";
import { Peer, PeerJSON } from "../peer/peer";
import RoutingTable from "../routingTable/routingTable";
import WebSocketTransport from "../transports/tcp/wsTransport";
import UDPTransport from "../transports/udp/udpTransport";
import { MessageType, PacketType, Transports } from "../types/messageTypes";
import { BroadcastData, DirectData, TcpPacket } from "../types/udpTransportTypes";
import { extractError } from "../utils/extractError";
import { chunk, getIdealDistance, hashKeyAndmapToKeyspace } from "../utils/nodeUtils";
import AbstractNode from "./abstractNode/abstractNode";
import { ALPHA, BIT_SIZE } from "./constants";
import { NodeUtils } from "./nodeUtils";

type StoreData = MessagePayload<UDPDataInfo & { key?: string; value?: string }>;

class KademliaNode extends AbstractNode {
	public readonly nodeContact: Peer;
	public readonly table: RoutingTable;
	public readonly contacted = new Map<string, number>();
	public readonly api: App;

	public readonly udpTransport: UDPTransport;
	public readonly wsTransport: WebSocketTransport;

	private readonly discScheduler: DiscoveryScheduler;
	private contactedPeers: Map<string, Peer>;
	private failedContacts: Map<string, Peer>;

	constructor(id: number, port: number) {
		super(id, port, "kademlia");
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

				await this.updatePeerDiscoveryInterval(routingPeers);
				await this.refreshAndUpdateConnections(routingPeers);
			} catch (error) {
				this.log.error(`message: ${extractError(error)}, fn: executeCronTask`);
			}
		});
	}

	private findNodes = async (key: number): Promise<Peer[]> => {
		const contacts = new Map<string, Peer>();
		let iteration: number = null;
		const shortlist = this.table.findNode(key, ALPHA);
		await this.findNodeRecursiveSearch(contacts, shortlist, iteration);
		return Array.from(contacts.values());
	};

	private handleFindNodeQuery = async (contacts: Map<string, Peer>, node: Peer, nodeShortlist: Peer[]) => {
		let hasCloserThanExist = false;
		try {
			const to = node.toJSON();
			const data = { resId: v4() };
			const message = NodeUtils.createUdpMessage(MessageType.FindNode, data, this.nodeContact, to);
			const findNodeResponse = this.udpTransport.sendMessage(message, this.udpMessageResolver);

			const closeNodes = await findNodeResponse;
			let initialClosestNode = nodeShortlist[0];

			contacts.set(node.nodeId.toString(), node);
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
			this.log.info(`message: ${extractError(e)}, fn: handleFindNodeQuery`);
		}

		return hasCloserThanExist;
	};

	private findNodeRecursiveSearch = async (contacts: Map<string, Peer>, nodeShortlist: Peer[], iteration: number) => {
		const findNodePromises: Array<Promise<boolean>> = [];

		iteration = iteration == null ? 0 : iteration + 1;
		const alphaContacts = nodeShortlist.slice(iteration * ALPHA, iteration * ALPHA + ALPHA);

		for (const node of alphaContacts) {
			if (contacts.has(node.toString())) continue;
			findNodePromises.push(this.handleFindNodeQuery(contacts, node, nodeShortlist));
		}

		if (!findNodePromises.length) {
			console.log("No more contacts in shortlist");
			return;
		}

		const results = await Promise.all(findNodePromises);
		const isUpdatedClosest = results.some(Boolean);

		if (isUpdatedClosest && contacts.size < BIT_SIZE) {
			await this.findNodeRecursiveSearch(contacts, nodeShortlist, iteration);
		}
	};

	public async store(key: number, value: string) {
		const closestNodes = await this.findNodes(this.nodeId);
		const closestNodesChunked = chunk<Peer>(closestNodes, ALPHA);

		for (const nodes of closestNodesChunked) {
			try {
				const promises = nodes.map((node) => {
					const data = { resId: v4(), key, value };
					const to = new Peer(node.nodeId, this.address, node.port);
					const message = NodeUtils.createUdpMessage(MessageType.Store, data, this.nodeContact, to);
					return this.udpTransport.sendMessage(message, this.udpMessageResolver);
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
					const to = new Peer(node.nodeId, this.address, node.port);
					const data = { resId: v4(), key, value: value, closestNodes };
					const message = NodeUtils.createUdpMessage(MessageType.FindValue, data, this.nodeContact, to);
					return this.udpTransport.sendMessage(message, this.udpMessageResolver);
				});

				const resolved = await Promise.all(promises);
				for await (const result of resolved) {
					if (typeof result === "string") return result;
					return null;
				}
			} catch (e) {
				console.error(e);
			}
		}
	}

	public handleMessage = async (msg: Buffer, info: dgram.RemoteInfo) => {
		try {
			const message = JSON.parse(msg.toString()) as Message<StoreData>;
			const externalContact = message.from.nodeId;
			await this.table.updateTables(new Peer(message.from.nodeId, this.address, message.from.port));

			switch (message.type) {
				case MessageType.Store: {
					await this.table.nodeStore<StoreData>(message.data.data?.key, message.data.data?.value);
					await this.handleMessageResponse(MessageType.Pong, message, message.data?.data);
					break;
				}
				case MessageType.Ping: {
					this.udpTransport.messages.PING.set(message.data.data.resId, message);
					await this.handleMessageResponse(MessageType.Pong, message, message.data?.data);
					break;
				}
				case MessageType.Reply: {
					const resId = message.data.data.resId;
					this.udpTransport.messages.REPLY.set(message.data.data.resId, message);
					this.emitter.emit(`response_reply_${resId}`, { ...message.data?.data, error: null });
					break;
				}
				case MessageType.Pong: {
					const resId = message.data.data.resId;
					this.emitter.emit(`response_pong_${resId}`, { resId, error: null });
					break;
				}
				case MessageType.FindNode: {
					const closestNodes = this.table.findNode(externalContact);
					const msgData = { resId: message.data.data.resId, closestNodes };

					this.udpTransport.messages.FIND_NODE.set(message.data.data.resId, message);
					await this.handleMessageResponse(MessageType.Reply, message, msgData);
					break;
				}
				case MessageType.FindValue: {
					const res = await this.table.findValue(message.data.data.key);
					const closestNodes = isArray(res) ? res : message.data?.data.closestNodes;

					const value = isArray(res) ? message.data?.data?.value : res;
					const msgData = { ...message.data?.data, closestNodes, value };
					await this.handleMessageResponse(MessageType.Reply, message, msgData);
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
			if (data?.value) {
				resolve(data.value);
			} else {
				const nodes = data.closestNodes.map((node: PeerJSON) =>
					Peer.fromJSON(node.nodeId, this.address, node.port, node.lastSeen),
				);
				resolve(nodes);
			}
		});

		this.emitter.once(`response_pong_${responseId}`, (data: any) => {
			if (data.error) {
				return reject(data.error);
			}
			resolve(data);
		});
	};

	private handleMessageResponse = async (type: MessageType, message: Message<StoreData>, data: any) => {
		const to = Peer.fromJSON(message.from.nodeId, message.from.address, message.from.port, message.from.lastSeen);
		const msg = NodeUtils.createUdpMessage(type, data, this.nodeContact, to);
		await this.udpTransport.sendMessage(msg, this.udpMessageResolver);
	};

	public sendTcpTransportMessage = <T extends BroadcastData | DirectData>(type: MessageType, payload: T) => {
		const message = NodeUtils.creatTcpMessage<T>(type, payload, this.nodeContact, this.nodeContact);
		this.wsTransport.sendMessage<T>(message);
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

	protected createTcpMessage = <T extends BroadcastData | DirectData>(to: PeerJSON, type: MessageType, payload: any) => {
		const from = this.nodeContact.toJSON();
		const packet = NodeUtils.buildPacket<T>(type, payload);
		return Message.create<TcpPacket<T>>(to, from, Transports.Tcp, packet, type);
	};

	public handleBroadcastMessage = async () => {
		console.log(`recieveing broadcasting message: ${this.port}`);
	};

	public handleDirectMessage = async () => {
		console.log(`recieving direct message: ${this.port}`);
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

	private updatePeerDiscoveryInterval = async (peers: Peer[]) => {
		const buckets = this.table.getAllBucketsLen();
		const isNteworkEstablished = NodeUtils.getIsNetworkEstablished(buckets, peers);

		const currentSchedule = this.discScheduler.schedule;
		const newSchedule = this.discScheduler.getNewSchedule(isNteworkEstablished);

		if (newSchedule !== currentSchedule) {
			this.discScheduler.setSchedule(newSchedule);
			this.discScheduler.stopCronJob();
			await this.initDiscScheduler();
			console.log(`setting disc interval to ${newSchedule}`);
		}
	};

	private refreshAndUpdateConnections = async (closestPeers: Peer[]) => {
		const ws = this.wsTransport;
		for (const peer of closestPeers) {
			const peerId = peer.nodeId.toString();

			if (peer.getIsNodeStale() && this.nodeId !== peer.nodeId) {
				const connection = ws.connections.get(peerId);
				if (connection) {
					await connection.close();
					ws.connections.delete(peerId);
					ws.neighbors.delete(peerId);
				}
			}
			if (!ws.connections.has(peerId)) {
				this.wsTransport.connect(peer.port, () => {
					console.log(`Connection from ${this.nodeId} to ${peer.port} established.`);
				});
			}
		}
	};
}

export default KademliaNode;
