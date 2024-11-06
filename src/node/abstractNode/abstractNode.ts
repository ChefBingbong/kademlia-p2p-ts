import { Logger } from "winston";
import { AppLogger } from "../../logging/logger";
import { P2PNetworkEventEmitter } from "../eventEmitter";
import { BaseNode } from "./BaseNode.interface";

abstract class AbstractNode extends AppLogger implements BaseNode {
	public readonly address: string;
	public readonly port: number;
	public readonly nodeId: number;

	public readonly log: Logger;
	protected readonly emitter: P2PNetworkEventEmitter;

	constructor(nodeId: number, port: number, id: string) {
		super(`${id}-node-logger`, false);
		this.nodeId = nodeId;
		this.port = port;
		this.address = "127.0.0.1";

		this.log = this.logger;
		this.emitter = new P2PNetworkEventEmitter(false);
	}

	// default method to listen for connections
	abstract listen: (cb?: any) => void;

	// default method to dtart node
	abstract start: () => Promise<void>;

	// default method for hanlding node messages
	abstract handleMessage: (...args: any) => Promise<void>;
}

export default AbstractNode;
