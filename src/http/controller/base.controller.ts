import { NextFunction, Request, Response } from "express";
import KademliaNode from "../../node/node";
import { MessageType, Transports } from "../../types/messageTypes";
import { BroadcastData, DirectData } from "../../types/udpTransportTypes";
import { hashKeyAndmapToKeyspace } from "../../utils/nodeUtils";

class BaseController {
	public node: KademliaNode;

	constructor(node: KademliaNode) {
		this.node = node;
	}
	public ping = async (req: Request, res: Response, next: NextFunction) => {
		return res.json({ message: "succes" });
	};

	public getNodeBuckets = async (req: Request, res: Response, next: NextFunction) => {
		return res.json({ message: this.node.table.getAllBuckets() });
	};

	public postDirectMessage = (req: Request, res: Response, next: NextFunction) => {
		try {
			const payload: DirectData = {
				type: "direct-message",
				message: `recieved direct message from node ${this.node.port}`,
				to: Number(req.body.id),
			};
			this.node.sendTcpTransportMessage<DirectData>(MessageType.Braodcast, payload);
			res.send("success");
		} catch (error) {
			next(error);
		}
	};

	public postBroadcast = (req: Request, res: Response, next: NextFunction) => {
		try {
			const payload: BroadcastData = {
				type: "broadcast-message",
				message: `recieved broadcast message from node ${this.node.port}`,
				peers: [],
			};
			this.node.sendTcpTransportMessage<BroadcastData>(MessageType.Braodcast, payload);
			res.send("success");
		} catch (error) {
			next(error);
		}
	};

	public getNodeMessages = (req: Request, res: Response, next: NextFunction) => {
		try {
			const type = req.query.type as MessageType;
			const messagesMap = this.node.getTransportMessages(Transports.Tcp, type);
			const messages = Array.from(messagesMap.values());
			return res.json({ result: messages });
		} catch (error) {
			next(error);
		}
	};

	public getNodeUDPMessages = (req: Request, res: Response, next: NextFunction) => {
		try {
			const type = req.query.type as MessageType;
			const messagesMap = this.node.getTransportMessages(Transports.Udp, type);
			const messages = Array.from(messagesMap.values());
			return res.json({ result: messages });
		} catch (error) {
			next(error);
		}
	};

	public findClosestNode = (req: Request, res: Response, next: NextFunction) => {
		try {
			console.log(req.params.id);
			const closest = this.node.table.findClosestNode(Number(req.params.id));
			return res.json({ result: closest });
		} catch (error) {
			next(error);
		}
	};

	public storeValue = async (req: Request, res: Response, next: NextFunction) => {
		try {
			const key = hashKeyAndmapToKeyspace(req.params.value);
			const closest = await this.node.store(key, req.params.value);
			return res.json({ result: closest, key });
		} catch (error) {
			next(error);
		}
	};

	public findValue = async (req: Request, res: Response, next: NextFunction) => {
		try {
			const closest = await this.node.findValue(req.params.key);
			return res.json({ result: closest });
		} catch (error) {
			next(error);
		}
	};
}

export default BaseController;
