import { anySignal } from "any-signal";
import { sleep } from "./sleep";

export class TimeoutError extends Error {
	constructor(message?: string) {
		super(`Timeout ${message || ""}`);
	}
}

export async function withTimeout<T>(
	asyncFn: (timeoutAndParentSignal?: AbortSignal) => Promise<T>,
	timeoutMs: number,
	signal?: AbortSignal,
): Promise<T> {
	const timeoutAbortController = new AbortController();
	const timeoutAndParentSignal = anySignal([timeoutAbortController.signal, ...(signal ? [signal] : [])]);

	async function timeoutPromise(signal: AbortSignal): Promise<never> {
		await sleep(timeoutMs, signal);
		throw new TimeoutError();
	}

	try {
		return await Promise.race([asyncFn(timeoutAndParentSignal), timeoutPromise(timeoutAndParentSignal)]);
	} finally {
		timeoutAbortController.abort();
	}
}
