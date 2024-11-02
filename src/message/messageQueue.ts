import { MessageQueue, Queue } from "./types";

export class MessageQueueMap<T> {
	private queueMap: MessageQueue<T>;

	constructor(senders: string[], rounds: number) {
		this.queueMap = this.initializeMessageQueue(senders, rounds);
	}

	private initializeMessageQueue(senders: string[], rounds: number): MessageQueue<T> {
		const q: MessageQueue<T> = {};
		for (let i = 0; i <= rounds; i++) {
			const queue: Queue<T> = {};
			senders.forEach((id) => {
				queue[id] = null;
			});
			q[i] = queue;
		}
		return q;
	}

	public set(round: number, id: string, value: T | null): void {
		if (this.queueMap[round] && this.queueMap[round][id] !== undefined) {
			this.queueMap[round][id] = value;
		}
	}

	public get(round: number, id: string): T | null {
		return this.queueMap[round] && this.queueMap[round][id] !== undefined ? this.queueMap[round][id] : null;
	}

	public getAll(): MessageQueue<T> {
		return this.queueMap;
	}

	public getRoundValues(round: number): Array<T | null> {
		return this.queueMap[round] ? Object.values(this.queueMap[round]).filter((item) => item !== null) : [];
	}

	public getRoundMessagesLen(round: number): number {
		return this.getMessagesLength(this.queueMap[round]);
	}

	private getMessagesLength(obj: any): number {
		return Object.keys(obj).reduce((count, key) => (obj[key] !== null ? count + 1 : count), 0);
	}

	public reset(): void {
		this.queueMap = this.initializeMessageQueue(
			Object.keys(this.queueMap[0]), // Use senders from round 0
			Object.keys(this.queueMap).length - 1,
		);
	}
}
