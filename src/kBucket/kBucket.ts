import { v4 } from "uuid";
import { MessagePayload, UDPDataInfo } from "../message/message";
import { BIT_SIZE, K_BUCKET_SIZE } from "../node/constants";
import KademliaNode from "../node/node";
import { NodeUtils } from "../node/nodeUtils";
import { Peer } from "../peer/peer";
import { MessageType } from "../types/messageTypes";

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
		this.nodes = this.nodes.filter((n) => n.nodeId !== peer.nodeId);
	};

	public containsNode = (peer: Peer) => {
		const peers = this.getNodes();
		return peers.find((node: Peer) => node.nodeId !== peer.nodeId);
	};

	public async updateBucketNode(peer: Peer) {
		const current = this.nodes.find((node) => node.nodeId === peer.nodeId);

		peer.updateLastSeen();

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
			if (this.node.nodeContact.nodeId === this.nodes[0].nodeId) return;
			// try check if node is only lone if not remove its id from the nodes arr
			const to = this.nodes[0].toJSON();
			const data = { resId: v4() };
			const message = NodeUtils.createUdpMessage<UDPDataInfo>(MessageType.Ping, data, this.node.nodeContact, to);
			return await this.node.udpTransport.sendMessage<MessagePayload<UDPDataInfo>>(message, this.node.udpMessageResolver);
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
