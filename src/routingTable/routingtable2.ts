import { AdaptiveTimeout } from "@libp2p/utils/adaptive-timeout";
import { PeerQueue } from "@libp2p/utils/peer-queue";
import { anySignal } from "any-signal";
import parallel from "it-parallel";
import { isLeafBucket, KBucket, LeafBucket } from "../kBucket/kBucket2";
import { setMaxListeners as nodeSetMaxListeners } from "events";
import { Peer } from "../peer/peer";
import { ClosestPeers } from "../peer/closeestPeers";
import PeerStore from "@libp2p/interface";
import { Stream } from "stream";
import { MessageType } from "../types/messageTypes";

export interface EventCallback<EventType> {
	(evt: EventType): void;
}
export interface EventObject<EventType> {
	handleEvent: EventCallback<EventType>;
}
export type EventHandler<EventType> = EventCallback<EventType> | EventObject<EventType>;

interface Listener {
	once: boolean;
	callback: any;
}

/**
 * Create a setMaxListeners that doesn't break browser usage
 */
export const setMaxListeners: typeof nodeSetMaxListeners = (n, ...eventTargets) => {
	try {
		nodeSetMaxListeners(n, ...eventTargets);
	} catch {
		// swallow error, gulp
	}
};

/**
 * Adds types to the EventTarget class. Hopefully this won't be necessary forever.
 *
 * https://github.com/microsoft/TypeScript/issues/28357
 * https://github.com/microsoft/TypeScript/issues/43477
 * https://github.com/microsoft/TypeScript/issues/299
 * etc
 */
export interface TypedEventTarget<EventMap extends Record<string, any>> extends EventTarget {
	addEventListener<K extends keyof EventMap>(
		type: K,
		listener: EventHandler<EventMap[K]> | null,
		options?: boolean | AddEventListenerOptions,
	): void;

	listenerCount(type: string): number;

	removeEventListener<K extends keyof EventMap>(
		type: K,
		listener?: EventHandler<EventMap[K]> | null,
		options?: boolean | EventListenerOptions,
	): void;

	removeEventListener(type: string, listener?: EventHandler<Event>, options?: boolean | EventListenerOptions): void;

	safeDispatchEvent<Detail>(type: keyof EventMap, detail: CustomEventInit<Detail>): boolean;
}

/**
 * An implementation of a typed event target
 * etc
 */
export class TypedEventEmitter<EventMap extends Record<string, any>> extends EventTarget implements TypedEventTarget<EventMap> {
	readonly #listeners = new Map<any, Listener[]>();

	constructor() {
		super();

		// silence MaxListenersExceededWarning warning on Node.js, this is a red
		// herring almost all of the time
		setMaxListeners(Infinity, this);
	}

	listenerCount(type: string): number {
		const listeners = this.#listeners.get(type);

		if (listeners == null) {
			return 0;
		}

		return listeners.length;
	}

	addEventListener<K extends keyof EventMap>(
		type: K,
		listener: EventHandler<EventMap[K]> | null,
		options?: boolean | AddEventListenerOptions,
	): void;
	addEventListener(type: string, listener: EventHandler<Event>, options?: boolean | AddEventListenerOptions): void {
		super.addEventListener(type, listener, options);

		let list = this.#listeners.get(type);

		if (list == null) {
			list = [];
			this.#listeners.set(type, list);
		}

		list.push({
			callback: listener,
			once: (options !== true && options !== false && options?.once) ?? false,
		});
	}

	removeEventListener<K extends keyof EventMap>(
		type: K,
		listener?: EventHandler<EventMap[K]> | null,
		options?: boolean | EventListenerOptions,
	): void;
	removeEventListener(type: string, listener?: EventHandler<Event>, options?: boolean | EventListenerOptions): void {
		super.removeEventListener(type.toString(), listener ?? null, options);

		let list = this.#listeners.get(type);

		if (list == null) {
			return;
		}

		list = list.filter(({ callback }) => callback !== listener);
		this.#listeners.set(type, list);
	}

	dispatchEvent(event: Event): boolean {
		const result = super.dispatchEvent(event);

		let list = this.#listeners.get(event.type);

		if (list == null) {
			return result;
		}

		list = list.filter(({ once }) => !once);
		this.#listeners.set(event.type, list);

		return result;
	}

	safeDispatchEvent<Detail>(type: keyof EventMap, detail: CustomEventInit<Detail> = {}): boolean {
		return this.dispatchEvent(new CustomEvent<Detail>(type as string, detail));
	}
}
export const KBUCKET_SIZE = 8;
export const PREFIX_LENGTH = 8;
export const PING_NEW_CONTACT_TIMEOUT = 2000;
export const PING_NEW_CONTACT_CONCURRENCY = 20;
export const PING_NEW_CONTACT_MAX_QUEUE_SIZE = 100;
export const PING_OLD_CONTACT_COUNT = 3;
export const PING_OLD_CONTACT_TIMEOUT = 2000;
export const PING_OLD_CONTACT_CONCURRENCY = 20;
export const PING_OLD_CONTACT_MAX_QUEUE_SIZE = 100;
export const KAD_PEER_TAG_NAME = "kad-peer";
export const KAD_PEER_TAG_VALUE = 1;
export const LAST_PING_THRESHOLD = 600000;
export const POPULATE_FROM_DATASTORE_ON_START = true;
export const POPULATE_FROM_DATASTORE_LIMIT = 1000;

export interface RoutingTableInit {
	logPrefix: string;
	metricsPrefix: string;
	protocol: string;
	prefixLength?: number;
	splitThreshold?: number;
	kBucketSize?: number;
	pingNewContactConcurrency?: number;
	pingNewContactMaxQueueSize?: number;
	pingOldContactConcurrency?: number;
	pingOldContactMaxQueueSize?: number;
	numberOfOldContactsToPing?: number;
	pingOldContactTimeout?: AdaptiveTimeoutInit;

	peerTagName?: string;
	peerTagValue?: number;
	closeTagName?: string;
	closeTagValue?: number;
	network: Network;
	populateFromDatastoreOnStart?: boolean;
	populateFromDatastoreLimit?: number;
	lastPingThreshold?: number;
	closestPeerSetSize?: number;
	closestPeerSetRefreshInterval?: number;
}

export interface RoutingTableEvents {
	"peer:add": CustomEvent<nodeId>;
	"peer:remove": CustomEvent<nodeId>;
	"peer:ping": CustomEvent<nodeId>;
}

/**
 * A wrapper around `k-bucket`, to provide easy store and retrieval for peers.
 */
export class RoutingTable extends TypedEventEmitter<RoutingTableEvents> {
	//   implements Startable
	public kBucketSize: number;
	public kb: KBucket;
	public network: Network;
	private readonly closestPeerTagger: ClosestPeers;
	private readonly components: Peer & { peerStore: PeerStore };
	private running: boolean;
	private readonly pingNewContactTimeout: AdaptiveTimeout;
	private readonly pingNewContactTimeout: AdaptiveTimeout;

	private readonly pingNewContactQueue: PeerQueue<boolean>;
	private readonly pingOldContactTimeout: AdaptiveTimeout;
	private readonly pingOldContactQueue: PeerQueue<boolean>;
	private readonly populateFromDatastoreOnStart: boolean;
	private readonly populateFromDatastoreLimit: number;
	public peerTagName;

	constructor(components: Peer & { peerStore: PeerStore }, init: RoutingTableInit) {
		super();

		this.components = components;

		this.kBucketSize = init.kBucketSize ?? KBUCKET_SIZE;
		this.running = false;

		this.network = init.network;
		this.pingOldContacts = this.pingOldContacts.bind(this);
		this.verifyNewContact = this.verifyNewContact.bind(this);
		this.peerAdded = this.peerAdded.bind(this);
		this.peerRemoved = this.peerRemoved.bind(this);
		this.populateFromDatastoreOnStart = init.populateFromDatastoreOnStart ?? POPULATE_FROM_DATASTORE_ON_START;
		this.populateFromDatastoreLimit = init.populateFromDatastoreLimit ?? POPULATE_FROM_DATASTORE_LIMIT;

		this.pingOldContactQueue = new PeerQueue({
			concurrency: init.pingOldContactConcurrency ?? PING_OLD_CONTACT_CONCURRENCY,
			metricName: `${init.metricsPrefix}_ping_old_contact_queue`,
			maxSize: init.pingOldContactMaxQueueSize ?? PING_OLD_CONTACT_MAX_QUEUE_SIZE,
		});
		this.pingOldContactTimeout = new AdaptiveTimeout({
			...(init.pingOldContactTimeout ?? {}),
			metricName: `${init.metricsPrefix}_routing_table_ping_old_contact_time_milliseconds`,
		});

		this.pingNewContactQueue = new PeerQueue({
			concurrency: init.pingNewContactConcurrency ?? PING_NEW_CONTACT_CONCURRENCY,
			metricName: `${init.metricsPrefix}_ping_new_contact_queue`,
			maxSize: init.pingNewContactMaxQueueSize ?? PING_NEW_CONTACT_MAX_QUEUE_SIZE,
		});
		this.pingNewContactTimeout = new AdaptiveTimeout({
			...(init.pingNewContactTimeout ?? {}),
			metricName: `${init.metricsPrefix}_routing_table_ping_new_contact_time_milliseconds`,
		});

		this.kb = new KBucket({
			kBucketSize: init.kBucketSize,
			prefixLength: init.prefixLength,
			splitThreshold: init.splitThreshold,
			numberOfOldContactsToPing: init.numberOfOldContactsToPing,
			lastSeenThreshold: init.lastPingThreshold,
			ping: this.pingOldContacts,
			verify: this.verifyNewContact,
			onAdd: this.peerAdded,
			onRemove: this.peerRemoved,
		});

		this.closestPeerTagger = new ClosestPeers(this.components, {
			logPrefix: init.logPrefix,
			routingTable: this,
			peerSetSize: init.closestPeerSetSize,
			refreshInterval: init.closestPeerSetRefreshInterval,
			closeTagName: init.closeTagName,
			closeTagValue: init.closeTagValue,
		});
	}
	isStarted(): boolean {
		return this.running;
	}

	async start(): Promise<void> {
		if (this.running) {
			return;
		}

		this.running = true;

		await this.start();
		await this.kb.addSelfPeer(this.components);
	}

	async afterStart(): Promise<void> {
		// do this async to not block startup but iterate serially to not overwhelm
		// the ping queue
		Promise.resolve()
			.then(async () => {
				if (!this.populateFromDatastoreOnStart) {
					return;
				}

				let peerStorePeers = 0;

				// add existing peers from the peer store to routing table
				for (const peer of await this.components.peerStore.all({
					filters: [
						(peer) => {
							return (
								// peer.protocols.includes(this.protocol) &&
								peer.tags.has(KAD_PEER_TAG_NAME)
							);
						},
					],
					limit: this.populateFromDatastoreLimit,
				})) {
					if (!this.running) {
						// bail if we've been shut down
						return;
					}

					try {
						await this.add(peer.id);
						peerStorePeers++;
					} catch (err) {
						this.log("failed to add peer %p to routing table, removing kad-dht peer tags - %e");
						await this.components.peerStore.merge(peer.id, {
							tags: {
								[this.peerTagName]: undefined,
							},
						});
					}
				}

				this.log("added %d peer store peers to the routing table", peerStorePeers);
			})
			.catch((err) => {
				this.log.error("error adding peer store peers to the routing table %e", err);
			});
	}

	async stop(): Promise<void> {
		this.running = false;
		// await stop(this.closestPeerTagger);
		this.pingOldContactQueue.abort();
		this.pingNewContactQueue.abort();
	}

	private async peerAdded(peer: Peer, bucket: LeafBucket): Promise<void> {
		if (this.components.nodeId !== peer.nodeId) {
			await this.components.peerStore.merge(peer.nodeId, {
				tags: {
					[this.peerTagName]: {
						value: peer.nodeId,
					},
				},
			});
		}

		this.updateMetrics();
		this.safeDispatchEvent("peer:add", { detail: peer.nodeId });
	}

	private async peerRemoved(peer: Peer, bucket: LeafBucket): Promise<void> {
		if (!this.components.nodeId.equals(peer.nodeId)) {
			await this.components.peerStore.merge(peer.nodeId, {
				tags: {
					[this.peerTagName]: undefined,
				},
			});
		}

		this.updateMetrics();
		this.metrics?.kadBucketEvents.increment({ peer_removed: true });
		this.safeDispatchEvent("peer:remove", { detail: peer.nodeId });
	}

	/**
	 * Called on the `ping` event from `k-bucket` when a bucket is full
	 * and cannot split.
	 *
	 * `oldContacts.length` is defined by the `numberOfNodesToPing` param
	 * passed to the `k-bucket` constructor.
	 *
	 * `oldContacts` will not be empty and is the list of contacts that
	 * have not been contacted for the longest.
	 */
	async *pingOldContacts(oldContacts: Peer[], options?: AbortOptions): AsyncGenerator<Peer> {
		if (!this.running) {
			return;
		}

		const jobs: Array<() => Promise<Peer | undefined>> = [];

		for (const oldContact of oldContacts) {
			if (this.kb.get(oldContact.nodeId) == null) {
				console.log("asked to ping contact %p that was not in routing table", oldContact.nodeId);
				continue;
			}

			jobs.push(async () => {
				// if a previous ping wants us to ping this contact, re-use the result
				const existingJob = this.pingOldContactQueue.find(oldContact.nodeId);

				if (existingJob != null) {
					console.log("asked to ping contact %p was already being pinged", oldContact.nodeId);
					const result = await existingJob.join(options);

					if (!result) {
						return oldContact;
					}

					return;
				}

				const result = await this.pingOldContactQueue.add(
					async (options) => {
						const signal = this.pingOldContactTimeout.getTimeoutSignal();
						const signals = anySignal([signal, options?.signal]);
						setMaxListeners(Infinity, signal, signals);

						try {
							return await this.pingContact(oldContact, options);
						} catch {
							return true;
						} finally {
							this.pingOldContactTimeout.cleanUp(signal);
						}
					},
					{
						nodeId: oldContact.nodeId,
						signal: options?.signal,
					},
				);

				if (!result) {
					return oldContact;
				}
			});
		}

		for await (const peer of parallel(jobs)) {
			if (peer != null) {
				yield peer;
			}
		}
	}

	async verifyNewContact(contact: Peer, options?: any): Promise<boolean> {
		const signal = this.pingNewContactTimeout.getTimeoutSignal();
		const signals = anySignal([signal, options?.signal]);
		setMaxListeners(Infinity, signal, signals);

		try {
			const job = this.pingNewContactQueue.find(contact.nodeId);

			if (job != null) {
				this.log("joining existing ping to add new peer %p to routing table", contact.nodeId);
				return await job.join({
					signal: signals,
				});
			} else {
				return await this.pingNewContactQueue.add(
					async (options) => {
						return this.pingContact(contact, options);
					},
					{
						nodeId: contact.nodeId,
						signal: signals,
					},
				);
			}
		} catch (err) {
			this.log.trace("tried to add peer %p but they were not online", contact.nodeId);

			return false;
		} finally {
			this.pingNewContactTimeout.cleanUp(signal);
		}
	}

	async pingContact(contact: Peer, options?: any): Promise<boolean> {
		let stream: Stream | undefined;

		try {
			this.log("pinging contact %p", contact.nodeId);

			for await (const event of this.network.sendRequest(contact.nodeId, { type: MessageType.Ping }, options)) {
				if (event.type === "PEER_RESPONSE") {
					if (event.messageType === MessageType.Ping) {
						this.log("contact %p ping ok", contact.nodeId);

						this.safeDispatchEvent("peer:ping", {
							detail: contact.nodeId,
						});

						return true;
					}

					return false;
				}
			}

			return false;
		} catch (err: any) {
			//   this.log("error pinging old contact %p - %e", contact.nodeId, err);
			// stream.
			return false;
		}
	}

	/**
	 * Amount of currently stored peers
	 */
	get size(): number {
		if (this.kb == null) {
			return 0;
		}

		return this.kb.count();
	}

	/**
	 * Find a specific peer by id
	 */
	async find(peer: Peer): Promise<Peer | undefined> {
		const kadId = peer.nodeId;
		return this.kb.get(kadId);
	}

	/**
	 * Retrieve the closest peers to the given kadId
	 */
	closestPeer(kadId: Peer): Peer | undefined {
		const res = this.closestPeers(kadId.nodeId, 1);

		if (res.length > 0) {
			return res[0];
		}

		return undefined;
	}

	/**
	 * Retrieve the `count`-closest peers to the given kadId
	 */
	closestPeers(kadId: number, count = this.kBucketSize): Peer[] {
		if (this.kb == null) {
			return [];
		}

		return [...this.kb.closest(kadId, count)];
	}

	/**
	 * Add or update the routing table with the given peer
	 */
	async add(nodeId: Peer, options?: any): Promise<void> {
		if (this.kb == null) {
			throw new Error("RoutingTable is not started");
		}

		await this.kb.add(nodeId, options);
	}

	/**
	 * Remove a given peer from the table
	 */
	async remove(peer: Peer): Promise<void> {
		if (this.kb == null) {
			throw new Error("RoutingTable is not started");
		}

		const kadId = peer.nodeId;

		await this.kb.remove(kadId);
	}

	private updateMetrics(): void {
		let size = 0;
		let buckets = 0;
		let maxDepth = 0;
		let minOccupancy = 20;
		let maxOccupancy = 0;

		function count(bucket: any): void {
			if (isLeafBucket(bucket)) {
				if (bucket.depth > maxDepth) {
					maxDepth = bucket.depth;
				}

				buckets++;
				size += bucket.peers.length;

				if (bucket.peers.length < minOccupancy) {
					minOccupancy = bucket.peers.length;
				}

				if (bucket.peers.length > maxOccupancy) {
					maxOccupancy = bucket.peers.length;
				}

				return;
			}

			count(bucket.left);
			count(bucket.right);
		}

		count(this.kb.root);
	}
}
