import config from "./src/config/config";
import KademliaNode from "./src/node/node";

// globalSetup.ts

export default async () => {
	const bootStrap = new KademliaNode(Number(config.port) - 3000, 3000);
	await bootStrap.start();
};