// import KademliaNode from "./node/node";
// // ? BIT_SIZE constant (assuming 4 for this example)

// async function main() {
//   // ! Create multiple node instances with unique IDs and ports
//   const nodes: KademliaNode[] = [];
//   const bootStrap = new KademliaNode(0, 3000);
//   bootStrap.start();

//   for (let i = 1; i < 16; i++) {
//     const nodeId = i;
//     const port = 3000 + i;
//     const node = new KademliaNode(nodeId, port);
//     nodes.push(node);
//   }

//   await Promise.all(nodes.map((node) => node.start()));
// }

// main().catch((error) => {
//   console.error("Error:", error);
// });
import config from "./config/config";
import KademliaNode from "./node/node";
// ? BIT_SIZE constant (assuming 4 for this example)
export const delay = async (delayTime: number) => await new Promise((resolve) => setTimeout(resolve, delayTime));

async function main() {
  // ! Create multiple node instances with unique IDs and ports
  const nodes = [];

  if (config.port === "3000") {
    const bootStrap = new KademliaNode(Number(config.port) - 3000, 3000);
    //     const bootStrap1 = new KademliaNode(1, 3001);

    bootStrap.start();
    nodes.push(bootStrap);
    //     bootStrap1.start();
  }
  // const nodes = []
  for (let i = 1; i < 16; i++) {
    const nodeId = Number(config.port) + i;
    const node = new KademliaNode(nodeId - 3000, nodeId);
    await node.start();
    nodes.push(node);
  }

  await delay(2000);
  nodes.forEach((n) => n.init());
}

main().catch((error) => {
  console.error("Error:", error);
});
