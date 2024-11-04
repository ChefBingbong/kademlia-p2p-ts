import { v4 } from "uuid";
import { MessagePayload, UDPDataInfo } from "../message/message";
import { MessageType } from "../message/types";
import { BIT_SIZE, K_BUCKET_SIZE } from "../node/constants";
import KademliaNode from "../node/node";
import { Peer } from "../peer/peer";

export class KBucket {
	public nodes: Peer[];
	public readonly bucketSize: number = BIT_SIZE;
	public readonly parentNodeId: number;
	public readonly bucketId: number;

	private readonly node: KademliaNode;

	constructor(bucketId: number, parentNodeId: number, node: KademliaNode) {
		this.bucketId = bucketId;
		this.parentNodeId = parentNodeId;
		this.nodes = [];
		this.node = node;
	}

	public getNodes(): Array<Peer> {
		return this.nodes;
	}

	public findPeer = (nodeId: number) => {
		const peers = this.getNodes();
		return peers.filter((peer: Peer) => peer.nodeId !== nodeId);
	};

	public removeNode = (peer: Peer) => {
		this.nodes = this.nodes.filter((node: Peer) => node.nodeId !== peer.nodeId);
	};

	public containsNode = (peer: Peer) => {
		const peers = this.getNodes();
		return peers.find((node: Peer) => node.nodeId === peer.nodeId);
	};

	public async updateBucketNode(peer: Peer) {
		const current = this.nodes.find((node) => node.nodeId === peer.nodeId);

		if (current) {
			this.moveToFront(current);
			return;
		}

		if (this.nodes.length < K_BUCKET_SIZE) {
			if (!this.containsNode(peer)) {
				this.nodes.push(peer);
			}
			return;
		}
		try {
			// try check if node is only lone if not remove its id from the nodes arr
			const recipient = {
				address: this.nodes[0].port.toString(),
				nodeId: this.nodes[0].nodeId,
			};
			const payload = this.node.buildMessagePayload<UDPDataInfo>(MessageType.Ping, { resId: v4() }, this.nodes[0].nodeId);
			const message = this.node.createUdpMessage<UDPDataInfo>(recipient, MessageType.Ping, payload);
			await this.node.udpTransport.sendMessage<MessagePayload<UDPDataInfo>>(message, this.node.udpMessageResolver);
		} catch (e) {
			this.nodes.shift();
			if (!this.containsNode(peer)) {
				this.nodes.push(peer);
			}
		}
	}

	public moveToFront(nodeId: Peer) {
		this.nodes = [nodeId, ...this.nodes.filter((n) => n !== nodeId)];
	}

	toJSON() {
		return {
			id: this.bucketId,
			nodeId: this.parentNodeId,
			nodes: this.nodes,
		};
	}
}
