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
import { randomInt } from "crypto";
import config from "./config/config";
import KademliaNode from "./node/node";
// ? BIT_SIZE constant (assuming 4 for this example)

async function main() {
  // ! Create multiple node instances with unique IDs and ports

  if (config.port === "3000") {
    const bootStrap2 = new KademliaNode(0, 2999);
    const bootStrap = new KademliaNode(0, 2998);
    bootStrap2.start();
    bootStrap.start();
  }

  for (let i = 0; i < 10; i++) {
    const node = new KademliaNode(randomInt(10), Number(config.port + i));
    await node.start();
  }
  //     console.log(node.contacts.buckets);
}

main().catch((error) => {
  console.error("Error:", error);
});
