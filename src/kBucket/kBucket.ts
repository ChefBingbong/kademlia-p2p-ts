import { v4 } from "uuid";
import { MessagePayload, UDPDataInfo } from "../message/message";
import { MessageType } from "../message/types";
import { BIT_SIZE, K_BUCKET_SIZE } from "../node/constants";
import KademliaNode from "../node/node";

export class KBucket {
	public nodes: number[];
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

	public getNodes(): Array<number> {
		return this.nodes;
	}

	public removeNode = (nodeId: number) => {
		this.nodes = this.nodes.filter((node: number) => node !== nodeId);
	};

	public async updateBucketNode(nodeId: number) {
		const current = this.nodes.find((n) => n === nodeId);

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
			const recipient = {
				address: (this.nodes[0] + 3000).toString(),
				nodeId: this.nodes[0],
			};
			const payload = this.node.buildMessagePayload<UDPDataInfo>(MessageType.Ping, { resId: v4() }, this.nodes[0]);
			const message = this.node.createUdpMessage<UDPDataInfo>(recipient, MessageType.Ping, payload);
			await this.node.udpTransport.sendMessage<MessagePayload<UDPDataInfo>>(message, this.node.udpMessageResolver);
		} catch (e) {
			this.nodes.shift();
			if (!this.nodes.includes(nodeId)) {
				this.nodes.push(nodeId);
			}
		}
	}

	public moveToFront(nodeId: number) {
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
