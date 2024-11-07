import { PeerDistanceList } from "./peerDistanceList.js";
import { RoutingTable } from "../routingTable/routingtable2.js";
import { Peer } from "./peer.js";
import { PeerSet } from "./peerSet.js";

export const PEER_SET_SIZE = 20;
export const REFRESH_INTERVAL = 5000;
export const KAD_CLOSE_TAG_NAME = "kad-close";
export const KAD_CLOSE_TAG_VALUE = 50;

export interface ClosestPeersInit {
	logPrefix: string;
	routingTable: RoutingTable;
	peerSetSize?: number;
	refreshInterval?: number;
	closeTagName?: string;
	closeTagValue?: number;
}

/**
 * Implemented by components that have a lifecycle
 */
export interface Startable {
	/**
	 * If implemented, this method will be invoked before the start method.
	 *
	 * It should not assume any other components have been started.
	 */
	beforeStart?(): void | Promise<void>;

	/**
	 * This method will be invoked to start the component.
	 *
	 * It should not assume that any other components have been started.
	 */
	start(): void | Promise<void>;

	/**
	 * If implemented, this method will be invoked after the start method.
	 *
	 * All other components will have had their start method invoked before this method is called.
	 */
	afterStart?(): void | Promise<void>;

	/**
	 * If implemented, this method will be invoked before the stop method.
	 *
	 * Any other components will still be running when this method is called.
	 */
	beforeStop?(): void | Promise<void>;

	/**
	 * This method will be invoked to stop the component.
	 *
	 * It should not assume any other components are running when it is called.
	 */
	stop(): void | Promise<void>;

	/**
	 * If implemented, this method will be invoked after the stop method.
	 *
	 * All other components will have had their stop method invoked before this method is called.
	 */
	afterStop?(): void | Promise<void>;
}

export function isStartable(obj: any): obj is Startable {
	return obj != null && typeof obj.start === "function" && typeof obj.stop === "function";
}

export async function start(...objs: any[]): Promise<void> {
	const startables: Startable[] = [];

	for (const obj of objs) {
		if (isStartable(obj)) {
			startables.push(obj);
		}
	}

	await Promise.all(
		startables.map(async (s) => {
			if (s.beforeStart != null) {
				await s.beforeStart();
			}
		}),
	);

	await Promise.all(
		startables.map(async (s) => {
			await s.start();
		}),
	);

	await Promise.all(
		startables.map(async (s) => {
			if (s.afterStart != null) {
				await s.afterStart();
			}
		}),
	);
}

export async function stop(...objs: any[]): Promise<void> {
	const startables: Startable[] = [];

	for (const obj of objs) {
		if (isStartable(obj)) {
			startables.push(obj);
		}
	}

	await Promise.all(
		startables.map(async (s) => {
			if (s.beforeStop != null) {
				await s.beforeStop();
			}
		}),
	);

	await Promise.all(
		startables.map(async (s) => {
			await s.stop();
		}),
	);

	await Promise.all(
		startables.map(async (s) => {
			if (s.afterStop != null) {
				await s.afterStop();
			}
		}),
	);
}

/**
 * Contains a list of the kad-closest peers encountered on the network.
 *
 * Once every few seconds, if the list has changed, it tags the closest peers.
 */
export class ClosestPeers implements Startable {
	private readonly routingTable: RoutingTable;
	private readonly components: Peer;
	private closestPeers: PeerSet;
	private newPeers?: PeerDistanceList;
	private readonly refreshInterval: number;
	private readonly peerSetSize: number;
	private timeout?: ReturnType<typeof setTimeout>;
	private readonly closeTagName: string;
	private readonly closeTagValue: number;
	private running: boolean;

	constructor(peer: Peer, init: ClosestPeersInit) {
		this.components = peer;

		this.routingTable = init.routingTable;
		this.refreshInterval = init.refreshInterval ?? REFRESH_INTERVAL;
		this.peerSetSize = init.peerSetSize ?? PEER_SET_SIZE;
		this.closeTagName = init.closeTagName ?? KAD_CLOSE_TAG_NAME;
		this.closeTagValue = init.closeTagValue ?? KAD_CLOSE_TAG_VALUE;

		this.closestPeers = new PeerSet();
		this.onPeerPing = this.onPeerPing.bind(this);
		this.running = false;
	}

	async start(): Promise<void> {
		if (this.running) {
			return;
		}

		this.running = true;

		const targetKadId = this.components.nodeId;
		this.newPeers = new PeerDistanceList(targetKadId, this.peerSetSize);
		this.routingTable.addEventListener("peer:ping", this.onPeerPing);

		this.timeout = setInterval(() => {
			this.updatePeerTags().catch((err) => {
				// this.log.error("error updating peer tags - %e", err);
			});
		}, this.refreshInterval);
	}

	stop(): void {
		this.running = false;
		this.routingTable.removeEventListener("peer:ping", this.onPeerPing);
		clearTimeout(this.timeout);
	}

	onPeerPing(event: CustomEvent<any>): void {
		this.newPeers?.add(event.detail).catch((err) => {
			console.log("error adding peer to distance list - %e", err);
		});
	}

	async updatePeerTags(): Promise<void> {
		const newClosest = new PeerSet(this.newPeers?.peers.map((peer) => peer));
		const added = newClosest.difference(this.closestPeers);
		const removed = this.closestPeers.difference(newClosest);
		this.closestPeers = newClosest;
	}
}
