import config from "./config/config";
import { RedisClient } from "./db/redis";
import KademliaNode from "./node/node";

export let node: KademliaNode;
export let redisClient: RedisClient;

export const updatePeerReplica = async (port: number, type: "DISCONNECT" | "CONNECT"): Promise<number[]> => {
	let peers = await redisClient.getSingleData<number[]>("validators");
	if (!peers) {
		await redisClient.setSignleData("validators", [port]);
		peers = [port];
	}
	if (type === "DISCONNECT")
		peers = [...peers].filter((value, index, self) => {
			return self.indexOf(value) === index && value !== port;
		});
	else
		peers = [...peers, port].filter((value, index, self) => {
			return self.indexOf(value) === index;
		});
	await redisClient.setSignleData("validators", peers);
	return peers;
};

export const startProtocol = async (): Promise<void> => {
	if (!redisClient) throw new Error(`redis not initialized`);
	const port = Number(config.port);

	node = new KademliaNode(port - 3000, port);
	await updatePeerReplica(port, "CONNECT");
	await node.start();

	process
		.on("SIGINT", async (reason) => {
			node.log.error(`SIGINT. ${reason}`);
			await updatePeerReplica(port, "DISCONNECT");
			process.exit();
		})
		.on("SIGTERM", async (reason) => {
			node.log.error(`SIGTERM. ${reason}`);
			await updatePeerReplica(port, "DISCONNECT");
		})
		.on("unhandledRejection", async (reason) => {
			node.log.error(`Unhandled Rejection at Promise. Reason: ${reason}`);
			await updatePeerReplica(port, "DISCONNECT");
		})
		.on("uncaughtException", async (reason) => {
			node.log.error(`Uncaught Exception Rejection at Promise. Reason: ${reason}`);
			await updatePeerReplica(port, "DISCONNECT");
		});
};

startProtocol().then(() => {
	console.log("Application started");
});
