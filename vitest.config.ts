// import tsconfigPaths from "vite-tsconfig-paths";
// vitest.config.js
import { defineConfig } from "vitest/config";

export default defineConfig({
	// plugins: [tsconfigPaths()],
	test: {
		poolOptions: {
			forks: {
				singleFork: true,
			},
		},
		globalSetup: ["./globalSetup.ts"],
		testTimeout: 300000,
	},
});