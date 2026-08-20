"use strict";

const fs = require("fs");
const path = require("path");

const targetVersion = process.env.npm_package_version;
if (!targetVersion) {
	console.error("No npm_package_version environment variable set. Run via 'npm version'.");
	process.exit(1);
}

const rootDir = path.resolve(__dirname, "..");
const manifestPath = path.join(rootDir, "manifest.json");

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
manifest.version = targetVersion;
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, "\t") + "\n");

console.log(`Updated manifest.json to version ${targetVersion}`);
