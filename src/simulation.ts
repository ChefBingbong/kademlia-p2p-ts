import config from "./config/config";
import KademliaNode from "./node/node";
export const delay = async (delayTime: number) => await new Promise((resolve) => setTimeout(resolve, delayTime));

async function main() {
  if (config.port === "3000") {
    const bootStrap = new KademliaNode(Number(config.port) - 3000, 3000);

    bootStrap.start();
  }
  for (let i = 1; i < 512; i++) {
    const nodeId = Number(config.port) + i;
    const node = new KademliaNode(nodeId - 3000, nodeId);
    await node.start();
  }
}

main().catch((error) => {
  console.error("Error:", error);
});
