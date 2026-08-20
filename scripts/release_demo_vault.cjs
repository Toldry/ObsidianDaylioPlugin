"use strict";

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const pkgPath = path.join(rootDir, "package.json");
const testVaultDir = path.join(rootDir, "obsidian_daylio_plugin_test_vault");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
const version = pkg.version;

console.log(`\n=== Packaging Demo Vault for plugin v${version} ===\n`);

// 1. Rebuild plugin and install into test vault
console.log("1. Building and syncing latest plugin to test vault...");
execSync("npm run update:test-vault", { cwd: rootDir, stdio: "inherit" });

// 2. Clean temporary workspace state
const workspaceFile = path.join(testVaultDir, ".obsidian", "workspace.json");
if (fs.existsSync(workspaceFile)) {
	fs.unlinkSync(workspaceFile);
	console.log("2. Removed test vault workspace.json");
}

// 3. Create zip archives (generic name and versioned name)
const genericZip = path.join(rootDir, "example-vault-daylio-demo.zip");
const versionedZip = path.join(rootDir, `example-vault-daylio-demo-v${version}.zip`);

console.log(`3. Creating zip archives: ${path.basename(genericZip)} and ${path.basename(versionedZip)}...`);

if (process.platform === "win32") {
	execSync(`powershell -Command "Compress-Archive -Path '${testVaultDir}' -DestinationPath '${genericZip}' -Force"`, { cwd: rootDir, stdio: "inherit" });
	fs.copyFileSync(genericZip, versionedZip);
} else {
	execSync(`zip -r "${genericZip}" obsidian_daylio_plugin_test_vault/`, { cwd: rootDir, stdio: "inherit" });
	fs.copyFileSync(genericZip, versionedZip);
}

// 4. Upload to GitHub demo-vault release
console.log("4. Uploading assets to GitHub demo-vault release...");
try {
	execSync(`gh release upload demo-vault "${genericZip}" "${versionedZip}" --clobber`, { cwd: rootDir, stdio: "inherit" });
	execSync(`gh release edit demo-vault --title "Daylio Mood Graph — Example Demo Vault (v${version})" --notes "Pre-configured demo vault containing sample Daylio data and event notes. Plugin version: v${version} (updated ${new Date().toISOString().split('T')[0]})."`, { cwd: rootDir, stdio: "inherit" });
	console.log("\n✅ Demo vault release successfully updated!");
} catch (err) {
	console.error("Failed to upload via gh CLI. Ensure 'gh' is authenticated.", err.message);
} finally {
	// 5. Cleanup temporary zip files
	if (fs.existsSync(genericZip)) fs.unlinkSync(genericZip);
	if (fs.existsSync(versionedZip)) fs.unlinkSync(versionedZip);
	console.log("Cleaned up temporary zip files.");
}
