export class Message<T> {
  public readonly From: string;
  public readonly To: string;
  public readonly Protocol: string;
  public readonly RoundNumber: number;
  public readonly Data: T;
  public readonly Broadcast: boolean;

  constructor(From: string, To: string, Protocol: string, RoundNumber: number, Data: T, Broadcast: boolean) {
    this.From = From;
    this.To = To;
    this.Protocol = Protocol;
    this.RoundNumber = RoundNumber;
    this.Data = Data;
    this.Broadcast = Broadcast;
  }

  toString(): string {
    return `message: round ${this.RoundNumber}, from: ${this.From}, to: ${this.To}, protocol: ${this.Protocol}`;
  }

  // TO-DO dont have genric type as any
  static isFor<T extends Message<any> | Message<any>>(id: string, msg: T): boolean {
    if (msg.From === id) {
      return false;
    }
    return msg.To === "" || msg.To === id;
  }

  static create<T>(
    From: string,
    To: string,
    Protocol: string,
    RoundNumber: number,
    Data: T,
    Broadcast: boolean,
  ): Message<T> {
    const msg = new Message<T>(From, To, Protocol, RoundNumber, Data, Broadcast);
    Object.freeze(msg);
    return msg;
  }
}
