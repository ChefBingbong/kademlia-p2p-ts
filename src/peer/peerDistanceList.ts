import { XOR } from "../utils/nodeUtils";
import { Peer } from "./peer";

function numberXorCompare(a: number, b: number): number {
	// Perform XOR operation between the two numbers
	const xor = a ^ b;

	// If the result is zero, the numbers are equal
	if (xor === 0) {
		return 0;
	}

	// If xor is negative, then 'a' is considered less than 'b'
	// If xor is positive, then 'a' is considered greater than 'b'
	// This handles the sign of the result of the XOR operation
	return xor < 0 ? -1 : 1;
}

interface PeerDistance {
	peer: Peer;
	distance: number;
}

/**
 * Maintains a list of peerIds sorted by distance from a DHT key.
 */
export class PeerDistanceList {
	/**
	 * The DHT key from which distance is calculated
	 */
	private readonly originDhtKey: number;

	/**
	 * The maximum size of the list
	 */
	private readonly capacity: number;

	private peerDistances: PeerDistance[];

	constructor(originDhtKey: number, capacity: number) {
		this.originDhtKey = originDhtKey;
		this.capacity = capacity;
		this.peerDistances = [];
	}

	/**
	 * The length of the list
	 */
	get length(): number {
		return this.peerDistances.length;
	}

	/**
	 * The peers in the list, in order of distance from the origin key
	 */
	get peers(): Peer[] {
		return this.peerDistances.map((pd) => pd.peer);
	}

	/**
	 * Add a peerId to the list.
	 */
	async add(peer: Peer): Promise<void> {
		const dhtKey = peer.nodeId;

		this.addWitKadId(peer, dhtKey);
	}

	/**
	 * Add a peerId to the list.
	 */
	addWitKadId(peer: Peer, kadId: number): void {
		if (this.peerDistances.find((pd) => pd.peer.nodeId === peer.nodeId) != null) {
			return;
		}

		const el = {
			peer,
			distance: XOR(this.originDhtKey, kadId),
		};

		this.peerDistances.push(el);
		this.peerDistances.sort((a, b) => a.distance - b.distance);
		this.peerDistances = this.peerDistances.slice(0, this.capacity);
	}

	/**
	 * Indicates whether any of the peerIds passed as a parameter are closer
	 * to the origin key than the furthest peerId in the PeerDistanceList.
	 */
	async isCloser(peer: Peer): Promise<boolean> {
		if (this.length === 0) {
			return true;
		}

		const dhtKey = peer.nodeId;
		const dhtKeyXor = XOR(dhtKey, this.originDhtKey);
		const furthestDistance = this.peerDistances[this.peerDistances.length - 1].distance;

		return numberXorCompare(dhtKeyXor, furthestDistance) === -1;
	}

	/**
	 * Indicates whether any of the peerIds passed as a parameter are closer
	 * to the origin key than the furthest peerId in the PeerDistanceList.
	 */
	async anyCloser(peers: Peer[]): Promise<boolean> {
		if (peers.length === 0) {
			return false;
		}

		return Promise.any(peers.map(async (peerId) => this.isCloser(peerId)));
	}
}
