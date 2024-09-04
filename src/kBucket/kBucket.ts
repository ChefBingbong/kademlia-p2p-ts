import { IContact, IKBucketOptions } from "../neighbours/types";

export class KBucket {
  private readonly maxContacts: number;
  private contacts: Array<IContact>;

  constructor(options: IKBucketOptions) {
    this.maxContacts = options.maxContacts;
    this.contacts = [];
  }

  public getContacts(): Array<IContact> {
    return this.contacts;
  }

  public updateContact(contact: IContact) {
    const current = this.contacts.find((c) => c.nodeId === contact.nodeId);

    if (current) {
      this.moveToEnd(current);
      return;
    }

    if (this.contacts.length < this.maxContacts) {
      this.contacts.push(contact);
      return;
    }

    // try {
    //     await this.node.ping(this.contacts[0]);
    // } catch (e) {
    //     // TODO: separate timeout and other errors
    //     this.contacts.shift();
    //     this.contacts.push(contact);
    // }
  }

  private moveToEnd(contact: IContact) {
    this.contacts = [...this.contacts.filter((c) => c !== contact), contact];
  }
}
