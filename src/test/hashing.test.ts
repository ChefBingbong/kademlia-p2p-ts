import { describe, expect, it } from "vitest";
import { HASH_SIZE } from "../node/constants";
import { hashKeyAndmapToKeyspace } from "../utils/nodeUtils";

function generateRandomStrings(numStrings: number, stringLength: number): string[] {
	const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"; // Characters to choose from
	const randomStrings: string[] = [];

	for (let i = 0; i < numStrings; i++) {
		let randomString = "";
		for (let j = 0; j < stringLength; j++) {
			const randomIndex = Math.floor(Math.random() * characters.length);
			randomString += characters[randomIndex];
		}
		randomStrings.push(randomString);
	}

	return randomStrings;
}

describe("Hashing tests", () => {
	it("generates correct key for storing and finding values on nodes", () => {
		const randomStrings = generateRandomStrings(20, 20);

		randomStrings.forEach((string) => {
			const key = hashKeyAndmapToKeyspace(string);
			expect(key).toBeLessThan(HASH_SIZE);
			expect(key).toBeGreaterThanOrEqual(0);
		});
	});
});
