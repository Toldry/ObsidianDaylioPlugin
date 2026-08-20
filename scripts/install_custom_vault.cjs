"use strict";

const fs = require('fs');
const path = require('path');

function loadEnvFile(filePath) {
    if (!fs.existsSync(filePath)) return {};
    const content = fs.readFileSync(filePath, 'utf8');
    const env = {};
    for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
        }
        env[key] = val;
    }
    return env;
}

const rootDir = path.resolve(__dirname, '..');
const envLocal = loadEnvFile(path.join(rootDir, '.env.local'));
const envDefault = loadEnvFile(path.join(rootDir, '.env'));

let vaultPath = process.env.OBSIDIAN_VAULT_PATH || envLocal.OBSIDIAN_VAULT_PATH || envDefault.OBSIDIAN_VAULT_PATH;

if (!vaultPath) {
    console.error(`
[Error] No OBSIDIAN_VAULT_PATH configured!

To install to your personal Obsidian vault:
1. Create a '.env.local' file in the project root (see .env.example)
2. Set your vault path, for example:
   OBSIDIAN_VAULT_PATH="C:/Users/YourUsername/Documents/MyVault"
   (or direct to: "C:/Users/YourUsername/Documents/MyVault/.obsidian/plugins/daylio-mood-graph")
`);
    process.exit(1);
}

// If vaultPath is the vault root rather than the plugin folder, append the standard plugin directory
if (!vaultPath.replace(/[/\\]$/, '').endsWith('daylio-mood-graph')) {
    vaultPath = path.join(vaultPath, '.obsidian', 'plugins', 'daylio-mood-graph');
}

const build_path = path.join(rootDir, 'build');
const build_files = ['main.js'];
const static_files = ['manifest.json', 'styles.css'];

if (!fs.existsSync(vaultPath)) {
    fs.mkdirSync(vaultPath, { recursive: true });
}

build_files.forEach(f => {
    const src = path.join(build_path, f);
    if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(vaultPath, f));
    }
});

static_files.forEach(f => {
    const src = path.join(rootDir, f);
    if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(vaultPath, f));
    }
});

console.log(`Successfully installed plugin to: ${vaultPath}`);
