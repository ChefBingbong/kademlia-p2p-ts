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
import { DHT } from "./dht/dht";

export const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const dhtList = [];
  const origin = new DHT();

  await origin.listen({
    address: "127.0.0.1",
    port: 12400,
  });

  for (let i = 0; i < 5; i++) {
    const dht = new DHT();

    try {
      await dht.listen({
        address: "127.0.0.1",
        port: 12300 + i,
      });
      console.log("listening at ", 12300 + i);
      await delay(500);
      await dht.join({
        ip: "127.0.0.1",
        port: 12400,
      });
      dhtList.push(dht);
    } catch (e) {
      console.log(e);
      break;
    }
  }
}

main();
