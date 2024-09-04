import { Contacts } from "../contacts/contacts";
import { IContact, IDHTOptions, TFoundNodes } from "../contacts/types";
import { K_BUCKET_SIZE } from "../node//constants";
import { Node } from "../node/RPCNode";
import { bucketIndex, chunk, sha1 } from "../node/utils";
const ALPHA = 3;
export class DHT {
  private readonly contacts: Contacts;
  private readonly node: Node;

  constructor() {
    this.contacts = new Contacts();
    this.node = new Node({
      contacts: this.contacts,
    });
  }

  public getContact() {
    return this.node.contact();
  }

  public listen(options: IDHTOptions) {
    return this.node.listen({
      port: options.port,
      address: options.address,
      nodeId: sha1(`${options.address}:${options.port}`).digest(),
    });
  }

  public async join(contact: Omit<IContact, "nodeId">) {
    /**
         * A node joins the network as follows:
            - if it does not already have a nodeID n, it generates one
            - it inserts the value of some known node c into the appropriate bucket as its first contact
            - it does an iterativeFindNode for n
            - it refreshes all buckets further away than its closest neighbor, which will be in the occupied bucket with the lowest index.

            If the node saved a list of good contacts and used one of these as the "known node" it would be consistent with this protocol.
         */
    await this.contacts.addContacts({
      ...contact,
      nodeId: sha1(`${contact.ip}:${contact.port}`).digest(),
    });

    const closestNodes = await this.findNode(this.node.contact().nodeId);
    await this.contacts.addContacts(closestNodes);
    console.log(this.node.contact().port, closestNodes);
  }

  public async store(key: string, block: string) {
    const closestNodes = await this.findNode(this.node.contact().nodeId);
    const closestNodesChunked = chunk<IContact>(closestNodes, ALPHA);

    for (const nodes of closestNodesChunked) {
      try {
        const promises = nodes.map((node) =>
          this.node.callRPC("STORE", node, {
            data: {
              key,
              block,
            },
          }),
        );

        await Promise.all(promises);
      } catch (e) {
        console.error(e);
      }
    }
  }

  public async findNode(key: Buffer) {
    return await this.lookup(key);
  }

  public async findValue(key: string) {
    const closestNodes = await this.findNode(this.node.contact().nodeId);
    const closestNodesChunked = chunk<IContact>(closestNodes, ALPHA);

    for (const nodes of closestNodesChunked) {
      try {
        const promises = nodes.map((node) =>
          this.node.callRPC("FIND_VALUE", node, {
            data: {
              key,
            },
          }),
        );

        for await (const result of promises) {
          if (typeof result === "string") {
            return result;
          }
        }
      } catch (e) {
        console.error(e);
      }
    }
  }

  private async lookup(key: Buffer) {
    const contacted = new Map<string, IContact>();
    const failed = new Set<string>();
    const shortlist = this.contacts.findNode(key, ALPHA);

    let currentClosestNode = shortlist[0];

    const proc = async (promise: Promise<TFoundNodes>, contact: IContact) => {
      let hasCloserThanExist = false;

      try {
        const result = await promise;
        console.log(currentClosestNode, key);
        contacted.set(contact.nodeId.toString("hex"), contact);

        for (const closerNode of (result as any).contacts) {
          shortlist.push(closerNode);

          const currentDistance = bucketIndex(key, currentClosestNode.nodeId);
          const distance = bucketIndex(key, (closerNode as any).nodeId.data);

          if (distance < currentDistance) {
            currentClosestNode = closerNode;
            hasCloserThanExist = true;
          }
        }
      } catch (e) {
        console.error(e);
        failed.add(contact.nodeId.toString("hex"));
      }

      return hasCloserThanExist;
    };

    let iteration: number;
    const communicate = async () => {
      const promises: Array<Promise<boolean>> = [];

      iteration = iteration == null ? 0 : iteration + 1;
      const alphaContacts = shortlist.slice(iteration * ALPHA, iteration * ALPHA + ALPHA);

      for (const contact of alphaContacts) {
        if (contacted.has(contact.nodeId.toString("hex"))) {
          continue;
        }
        const promise = this.node.callRPC("FIND_NODE", contact);
        promises.push(proc(promise as any, contact));
      }

      if (!promises.length) {
        console.log("No more contacts in shortlist");
        return;
      }
      console.log(promises.length, "pp");
      try {
        const results = await Promise.all(promises);
        const isUpdatedClosest = results.some(Boolean);

        if (isUpdatedClosest && contacted.size < K_BUCKET_SIZE) {
          await communicate();
        }
      } catch (error) {
        console.log(error);
      }
    };

    await communicate();

    return Array.from(contacted.values());
  }
}
