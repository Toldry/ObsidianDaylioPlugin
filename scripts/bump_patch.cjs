"use strict";

const fs   = require("fs");
const path = require("path");

function bump_patch() {
    // ── Bump patch in package.json ──────────────────────────────────────────────
    const pluginDir = path.resolve(__dirname, "..");
    const pkgPath = path.join(pluginDir, "package.json");
    const manifestPath = path.join(pluginDir, "manifest.json");

    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    const [major, minor, patch] = pkg.version.split(".").map(Number);
    const newVersion = `${major}.${minor}.${patch + 1}`;
    pkg.version = newVersion;
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, "\t") + "\n");

    // ── Keep manifest.json in sync ──────────────────────────────────────────────
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    manifest.version = newVersion;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, "\t") + "\n");

    process.stdout.write(`Plugin version bumped to ${newVersion}\n`);
}

module.exports = {
    bump_patch,
}

if (require.main === module) {
  // This block runs only if the script is executed directly
  console.log('Running directly');
  bump_patch(); 
}