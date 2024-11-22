import config from "./config/config";
import KademliaNode from "./node/node";

export let node: KademliaNode;

export const startProtocol = async (): Promise<void> => {
	const port = Number(config.port);
	node = new KademliaNode(port - 3000, port);
	await node.start();

	process
		.on("SIGINT", async (reason) => {
			node.log.error(`SIGINT. ${reason}`);
			process.exit(1);
		})
		.on("SIGTERM", async (reason) => {
			node.log.error(`SIGTERM. ${reason}`);
			process.exit(1);
		})
		.on("unhandledRejection", async (reason) => {
			node.log.error(`Unhandled Rejection at Promise. Reason: ${reason}`);
			process.exit(1);
		})
		.on("uncaughtException", async (reason) => {
			node.log.error(`Uncaught Exception Rejection at Promise. Reason: ${reason}`);
			process.exit(1);
		});
};

startProtocol().then(() => {
	console.log("Application started");
});
