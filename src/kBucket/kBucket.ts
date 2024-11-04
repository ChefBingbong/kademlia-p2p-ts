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

	public removeNode = (nodeId: Peer) => {
		this.nodes = this.nodes.filter((node: Peer) => node.nodeId !== nodeId.nodeId);
	};

	public async updateBucketNode(nodeId: Peer) {
		const current = this.nodes.find((node: Peer) => node.nodeId !== nodeId.nodeId);

		if (current) {
			this.moveToFront(current);
			return;
		}

		if (this.nodes.length < K_BUCKET_SIZE) {
			if (!this.nodes.includes(nodeId)) {
				this.nodes.push(nodeId);
			}
			return;
		}
		try {
			// try check if node is only lone if not remove its id from the nodes arr
			const payload = this.node.buildMessagePayload<UDPDataInfo>(MessageType.Ping, { resId: v4() }, this.nodes[0].nodeId);
			const message = this.node.createUdpMessage<UDPDataInfo>(this.nodes[0], MessageType.Ping, payload);
			await this.node.udpTransport.sendMessage<MessagePayload<UDPDataInfo>>(message, this.node.udpMessageResolver);
		} catch (e) {
			this.nodes.shift();
			if (!this.nodes.includes(nodeId)) {
				this.nodes.push(nodeId);
			}
		}
	}

	public moveToFront(peer: Peer) {
		this.nodes = [peer, ...this.nodes.filter((node: Peer) => peer.nodeId !== node.nodeId)];
	}

	toJSON() {
		return {
			id: this.bucketId,
			nodeId: this.parentNodeId,
			nodes: this.nodes,
		};
	}
}
