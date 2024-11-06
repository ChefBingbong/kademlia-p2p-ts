import { Peer } from "../peer/peer";
import WebSocketTransport from "../transports/tcp/wsTransport";
import { BIT_SIZE } from "./constants";

export class NodeUtils {
	public static getIsNetworkEstablished = (numBuckets: number, numPeers: number) => {
		const minPeers = Boolean(numPeers >= BIT_SIZE * 2 - BIT_SIZE / 2);
		return Boolean(minPeers && numBuckets === BIT_SIZE);
	};

	public static refreshNodeConnections = async (peers: Peer[], ws: WebSocketTransport) => {
		peers.forEach(async (peer: Peer) => {
			if (peer.getIsNodeStale()) {
				const peerId = peer.nodeId.toString();
				const connection = ws.connections.get(peerId);

				if (connection) {
					await connection.close();
					ws.connections.delete(peerId);
					ws.neighbors.delete(peerId);
				}
			}
		});
	};
}
