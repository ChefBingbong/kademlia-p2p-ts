import crypto, { BinaryLike, createHash } from "crypto";
import * as Mathjs from "mathjs";
import { BIT_SIZE, HASH_SIZE } from "../node/constants";
import { Peer } from "../peer/peer";

export const XOR = (n1: number, n2: number) => {
	return Mathjs.bitXor(Mathjs.bignumber(n1), Mathjs.bignumber(n2)).toNumber();
};

export function getIdealDistance() {
	const IDEAL_DISTANCE: Peer[] = [];
	for (let i = 0; i < BIT_SIZE; i++) {
		const val = 2 ** i;
		IDEAL_DISTANCE.push(new Peer(val, "127.0.0.1", val + 3000));
	}
	return IDEAL_DISTANCE;
}

// * Experimental Distance with Hex
export function distance(nodeId1: string, nodeId2: string): number {
	const buffer1 = Buffer.from(nodeId1, "hex");
	const buffer2 = Buffer.from(nodeId2, "hex");
	let result = 0;
	for (let i = 0; i < buffer1.length; i++) {
		result ^= buffer1[i] ^ buffer2[i];
	}
	return result;
}

// ! NOTE: Dumb way probability will no distributed evenly
export function generateRandomBN(): string {
	let binaryNumber = "";
	for (let i = 0; i < BIT_SIZE; i++) {
		const bit = Math.random() < 0.5 ? "0" : "1";
		binaryNumber += bit;
	}
	return binaryNumber;
}

export function xor(a: Buffer, b: Buffer) {
	const length = Math.max(a.length, b.length);
	const buffer = Buffer.allocUnsafe(length);

	for (let i = 0; i < length; ++i) {
		buffer[i] = a[i] ^ b[i];
	}

	return buffer;
}

export function getKBucketIndex(nodeId: number, targetId: number): number {
	// XOR the two IDs to find the distance
	const xorResult = nodeId ^ targetId;

	for (let i = 3; i >= 0; i--) {
		if (xorResult & (1 << i)) return i;
	}
	return 0;
}

export function bucketIndex(a: Buffer, b: Buffer) {
	const d = xor(a, b);
	let B = HASH_SIZE;

	for (let i = 0; i < d.length; i++) {
		if (d[i] === 0) {
			B -= 8;
			continue;
		}

		for (let j = 0; j < 8; j++) {
			if (d[i] & (0x80 >> j)) {
				return --B;
			}

			B--;
		}
	}

	return B;
}

export function timeoutReject<R = unknown>(error?: Error): Promise<never | R> {
	return new Promise<R>((_, rej) => {
		setTimeout(() => rej(error ?? new Error("timeout")), 60000);
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
