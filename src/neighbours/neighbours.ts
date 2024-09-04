import * as dgram from "dgram";
import { KBucket } from "../kBucket/kBucket";
import { K_BUCKET_SIZE } from "../node/constants";
import { bucketIndex } from "../node/utils";
import { IContact, TStoreRPC } from "./types";

export class Contacts {
  public readonly buckets: Map<number, KBucket>;
  private readonly _store: Map<string, string>;
  public contacts: IContact[] = [];
  private me: IContact;

  constructor() {
    this.buckets = new Map();
    this._store = new Map();
  }

  public setMe(me: IContact) {
    this.me = me;
  }

  private getBucket(remote: IContact) {
    const index = bucketIndex(Buffer.from(this.me.nodeId), Buffer.from(remote.nodeId));

    if (!this.buckets.has(index)) {
      const bucket = new KBucket({
        maxContacts: K_BUCKET_SIZE,
      });
      this.contacts.push(remote);
      this.buckets.set(index, bucket);
    }

    return this.buckets.get(index);
  }

  public addContacts(contact: IContact | Array<IContact>) {
    const contacts = Array.isArray(contact) ? contact : [contact];

    for (const c of contacts) {
      const bucket = this.getBucket(c);
      bucket.updateContact(c);
    }
  }

  public store(message: TStoreRPC, info: dgram.RemoteInfo) {
    const { data } = message;
    const { key, block } = data;
    this._store.set(key, block);
  }
}
