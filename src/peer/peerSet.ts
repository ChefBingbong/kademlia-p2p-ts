import { Peer } from "./peer.js";

/**
 * Calls the passed map function on every entry of the passed iterable iterator
 */
export function mapIterable<T, R>(iter: IterableIterator<T>, map: (val: T) => R): IterableIterator<R> {
	const iterator: IterableIterator<R> = {
		[Symbol.iterator]: () => {
			return iterator;
		},
		next: () => {
			const next = iter.next();
			const val = next.value;

			if (next.done === true || val == null) {
				const result: IteratorReturnResult<any> = {
					done: true,
					value: undefined,
				};

				return result;
			}

			return {
				done: false,
				value: map(val),
			};
		},
	};

	return iterator;
}

// export function peerIdFromString(str: string): PeerId {
//   const multihash = Digest.decode(base58btc.decode(`z${str}`));
//   return peerIdFromMultihash(multihash);
// }

export class PeerSet {
	private readonly set: Set<string>;

	constructor(set?: PeerSet | Iterable<Peer>) {
		this.set = new Set();

		if (set != null) {
			for (const key of set) {
				this.set.add(key.toString());
			}
		}
	}

	get size(): number {
		return this.set.size;
	}

	[Symbol.iterator](): IterableIterator<Peer> {
		return this.values();
	}

	add(peer: Peer): void {
		this.set.add(peer.toString());
	}

	clear(): void {
		this.set.clear();
	}

	delete(peer: Peer): void {
		this.set.delete(peer.toString());
	}

	entries(): IterableIterator<[Peer, Peer]> {
		return mapIterable<[string, string], [Peer, Peer]>(this.set.entries(), (val) => {
			const peer = new Peer(Number(val), "127.0.0.1", Number(val) + 3000);

			return [peer, peer];
		});
	}

	forEach(predicate: (Peer: Peer, index: Peer, set: PeerSet) => void): void {
		this.set.forEach((val) => {
			const peer = new Peer(Number(val), "127.0.0.1", Number(val) + 3000);

			predicate(peer, peer, this);
		});
	}

	has(peer: Peer): boolean {
		return this.set.has(peer.toString());
	}

	values(): IterableIterator<Peer> {
		return mapIterable<string, Peer>(this.set.values(), (val) => {
			return new Peer(Number(val), "127.0.0.1", Number(val) + 3000);
		});
	}

	intersection(other: PeerSet): PeerSet {
		const output = new PeerSet();

		for (const Peer of other) {
			if (this.has(Peer)) {
				output.add(Peer);
			}
		}

		return output;
	}

	difference(other: PeerSet): PeerSet {
		const output = new PeerSet();

		for (const Peer of this) {
			if (!other.has(Peer)) {
				output.add(Peer);
			}
		}

		return output;
	}

	union(other: PeerSet): PeerSet {
		const output = new PeerSet();

		for (const Peer of other) {
			output.add(Peer);
		}

		for (const Peer of this) {
			output.add(Peer);
		}

		return output;
	}
}

export function peerSet(): PeerSet {
	return new PeerSet();
}
