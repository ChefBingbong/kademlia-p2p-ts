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
import WebSocketTransport from "./transports/tcp/wsTransport";
// ? BIT_SIZE constant (assuming 4 for this example)
export const delay = async (delayTime: number) => await new Promise((resolve) => setTimeout(resolve, delayTime));

async function main() {
  const port = Number(config.port);
  const nodeId = port - 3000;

  const ports = [];

  for (let i = 3000; i < port; i++) {
    ports.push(i);
  }
  const node = new WebSocketTransport(nodeId, port, ports);
  await node.listen();
}

main().catch((error) => {
  console.error("Error:", error);
});
