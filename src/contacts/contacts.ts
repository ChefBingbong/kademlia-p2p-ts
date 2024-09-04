import * as dgram from "dgram";
import { KBucket } from "../kBucket/kBucket";
import { HASH_SIZE, K_BUCKET_SIZE } from "../node/constants";
import { bucketIndex, xor } from "../node/utils";
import { IContact, TStoreRPC } from "./types";

export class Contacts {
  private readonly buckets: Map<number, KBucket>;
  private readonly _store: Map<string, string>;
  private me: IContact;

  constructor() {
    this.buckets = new Map();
    this._store = new Map();
  }

  private getBucket(remote: IContact) {
    const index = bucketIndex(this.me.nodeId, remote.nodeId);

    if (!this.buckets.has(index)) {
      const bucket = new KBucket({
        maxContacts: K_BUCKET_SIZE,
      });

      this.buckets.set(index, bucket);
    }

    return this.buckets.get(index);
  }

  public setMe(me: IContact) {
    this.me = me;
  }

  public async addContacts(contact: IContact | Array<IContact>) {
    const contacts = Array.isArray(contact) ? contact : [contact];

    const promises: Array<Promise<unknown>> = [];

    for (const c of contacts) {
      const bucket = this.getBucket(c);
      promises.push(bucket.updateContact(c));
    }

    await Promise.all(contacts);
    console.log(this.buckets.size);
  }

  public findNode(key: Buffer, count: number = K_BUCKET_SIZE): Array<IContact> {
    const contacts: Array<{
      distance: Buffer;
      contact: IContact;
    }> = [];

    const closestBucketIndex = bucketIndex(key, this.me.nodeId);
    let aboveIndex = closestBucketIndex + 1;
    let belowIndex = closestBucketIndex - 1;

    const canIterateAbove = () => {
      return aboveIndex !== HASH_SIZE; // 159
    };

    const canIterateBelow = () => {
      return belowIndex > 0;
    };

    const proc = (bucket: KBucket) => {
      if (!bucket) {
        return;
      }

      for (const contact of bucket.getContacts()) {
        if (contact.nodeId.equals(key)) {
          continue;
        }

        if (contacts.length === count) {
          break;
        }

        contacts.push({
          distance: xor(contact.nodeId, key),
          contact,
        });
      }
    };

    proc(this.buckets.get(closestBucketIndex));

    while (true) {
      if (contacts.length === count || (!canIterateBelow() && !canIterateAbove())) {
        break;
      }

      while (canIterateAbove()) {
        if (this.buckets.has(aboveIndex)) {
          proc(this.buckets.get(aboveIndex));
          aboveIndex++;
          break;
        }

        aboveIndex++;
      }

      while (canIterateBelow()) {
        if (this.buckets.has(belowIndex)) {
          proc(this.buckets.get(belowIndex));
          belowIndex--;
          break;
        }

        belowIndex--;
      }
    }

    contacts.sort((a, b) => a.distance.compare(b.distance));
    return contacts.map((c) => c.contact);
  }

  public async findValue(key: string): Promise<string | Array<IContact>> {
    if (this._store.has(key)) {
      return this._store.get(key);
    }

    return this.findNode(Buffer.from(key, "hex"));
  }

  public store(message: TStoreRPC, info: dgram.RemoteInfo) {
    /**
     * TODO:
     *  - reply
     *  - chunked data
     *  - handle errors, like I/O, disk size...
     *  - send result
     */
    const { data } = message;
    const { key, block } = data;
    this._store.set(key, block);
  }
}
