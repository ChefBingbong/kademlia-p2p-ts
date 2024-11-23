import crypto, { BinaryLike, createHash } from "crypto";
import * as Mathjs from "mathjs";
import { BIT_SIZE, HASH_SIZE } from "../node/constants";
import { Peer } from "../peer/peer";

export const XOR = (n1: number, n2: number) => {
	return Mathjs.bitXor(Mathjs.bignumber(n1), Mathjs.bignumber(n2)).toNumber();
};

export function getIdealDistance() {
	const clostest: Peer[] = [];
	for (let i = 0; i < BIT_SIZE; i++) {
		const val = 2 ** i;
		clostest.push(new Peer(val, "127.0.0.1", val + 3000));
	}

	const hardcodedPeerList: Peer[] = [];

	for (let i = 0; i < clostest.length; i++) {
		const res = (this.nodeContact.nodeId ^ clostest[i].nodeId) as number;
		hardcodedPeerList.push(new Peer(res, this.address, res + 3000));
	}
	return hardcodedPeerList;
}

export function getKBucketIndex(nodeId: number, targetId: number): number {
	// XOR the two IDs to find the distance
	const xorResult = nodeId ^ targetId;

	for (let i = 3; i >= 0; i--) {
		if (xorResult & (1 << i)) return i;
	}
	return 0;
}

export function timeoutReject<R = unknown>(error?: Error): Promise<never | R> {
	return new Promise<R>((_, rej) => {
		setTimeout(() => rej(error ?? new Error("timeout")), 45000);
	});
}

export function sha1(str: BinaryLike) {
	return createHash("sha1").update(str);
}

export function chunk<T = any>(arr: T[], count: number): T[][] {
	const result: T[][] = [];
	const resultLength = Math.ceil(arr.length / count);

	for (let i = 0; i < resultLength; i++) {
		const index = i * count;
		const current = arr.slice(index, index + count);
		result.push(current);
	}

	return result;
}

export const extractNumber = (message: string) => {
	const regex = /TIMEOUT:\s*(\d+)/;
	const match = message.match(regex);
	return match ? Number(match[1]) : null;
};

export const generateHash = (data: string) => {
	return crypto.createHash("sha1").update(data).digest("hex");
};

export const hashKeyAndmapToKeyspace = (data: string) => {
	const hash = generateHash(data).substring(0, 8);
	return parseInt(hash, 16) % HASH_SIZE;
};

export const isArray = (value: any) => Array.isArray(value);
