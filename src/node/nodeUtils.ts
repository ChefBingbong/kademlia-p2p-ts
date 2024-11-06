import { v4 } from "uuid";
import { Message, MessagePayload, UDPDataInfo } from "../message/message";
import { Peer, PeerJSON } from "../peer/peer";
import { MessageType, PacketType, Transports } from "../types/messageTypes";
import { BroadcastData, DirectData, TcpPacket } from "../types/udpTransportTypes";
import { BIT_SIZE } from "./constants";

export class NodeUtils {
	public static getIsNetworkEstablished = (numBuckets: number, peers: Peer[]) => {
		const minPeers = Boolean(peers.length >= BIT_SIZE * 2 - BIT_SIZE / 2);
		return Boolean(minPeers && numBuckets === BIT_SIZE);
	};

	public static createUdpMessage = <T extends UDPDataInfo>(
		type: MessageType,
		data: T,
		from: PeerJSON,
		to: PeerJSON,
	): Message<MessagePayload<T>> => {
		const payload = NodeUtils.buildMessagePayload<T>(type, data, from, to);
		return Message.create<MessagePayload<T>>(to, from, Transports.Udp, payload, type);
	};

	public static creatTcpMessage = <T extends DirectData | BroadcastData>(
		type: MessageType,
		data: T,
		from: PeerJSON,
		to: PeerJSON,
	): Message<TcpPacket<T>> => {
		const payload = NodeUtils.buildPacket<T>(type, data);
		return Message.create<TcpPacket<T>>(to, from, Transports.Tcp, payload, type);
	};

	public static buildPacket = <T extends BroadcastData | DirectData>(
		type: MessageType,
		message: any,
		ttl: number = 255,
	): TcpPacket<T> => {
		return {
			id: v4(),
			ttl: ttl,
			type: type === MessageType.Braodcast ? PacketType.Broadcast : PacketType.Direct,
			message,
			destination: message.to,
			origin: message.from,
		};
	};

	public static buildMessagePayload = <T extends UDPDataInfo>(
		type: MessageType,
		data: T,
		from: PeerJSON,
		to: PeerJSON,
	): MessagePayload<T> => {
		return {
			description: `${from} Recieved Peer discovery ${type} from ${to}`,
			type,
			data,
			from,
			to,
		};
	};
}
