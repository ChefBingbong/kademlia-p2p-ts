export class Message<T> {
  public readonly from: string;
  public readonly to: string;
  public readonly protocol: string;
  public readonly data: T;
  public readonly type: string;

  constructor(from: string, to: string, protocol: string, data: T, type: string) {
    this.from = from;
    this.to = to;
    this.protocol = protocol;
    this.data = data;
    this.type = type;
  }

  toString(): string {
    return `message: from: ${this.from}, to: ${this.to}, protocol: ${this.protocol}`;
  }

  // TO-DO dont have genric type as any
  static isFor<T extends Message<any> | Message<any>>(id: string, msg: T): boolean {
    if (msg.from === id) {
      return false;
    }
    return msg.to === "" || msg.to === id;
  }

  static create<T>(From: string, To: string, Protocol: string, Data: T, type: string): Message<T> {
    const msg = new Message<T>(From, To, Protocol, Data, type);
    Object.freeze(msg);
    return msg;
  }
}
