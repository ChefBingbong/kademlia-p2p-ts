export interface Queue<T> {
  [partyId: string]: T | null;
}

export interface MessageQueue<T> {
  [roundNumber: number]: Queue<T>;
}
