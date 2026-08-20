import { defineConfig } from "vitest/config";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	test: {
		environment: "node",
		include: ["tests/**/*.test.ts"],
	},
	resolve: {
		alias: {
			// Redirect Obsidian's package to a minimal stub so tests
			// can import source modules without a real Obsidian runtime.
			obsidian: path.resolve(__dirname, "tests/__mocks__/obsidian.ts"),
		},
	},
});
