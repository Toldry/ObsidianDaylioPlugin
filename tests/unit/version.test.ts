import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

describe("Plugin version alignment", () => {
	it("manifest.json version matches package.json version", () => {
		const rootDir = path.resolve(__dirname, "../..");
		const pkgPath = path.join(rootDir, "package.json");
		const manifestPath = path.join(rootDir, "manifest.json");

		const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { version: string };
		const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as { version: string };

		expect(pkg.version).toBeDefined();
		expect(typeof pkg.version).toBe("string");
		expect(pkg.version.length).toBeGreaterThan(0);

		expect(manifest.version).toBeDefined();
		expect(manifest.version).toBe(pkg.version);
	});
});
