#!/usr/bin/env node
/**
 * PostToolUse hook — bumps the patch segment of the version in both
 * package.json and manifest.json whenever Claude edits any plugin file.
 *
 * Triggered by:  .claude/settings.json  →  hooks.PostToolUse  (Edit|Write)
 * Skipped when:  the edited file is outside the project root, is itself
 *                package.json or manifest.json (avoids re-entrant loops),
 *                or lives inside .claude/ (hook/config files).
 */
"use strict";

const fs   = require("fs");
const path = require("path");
const bump_patch = require("./bump_patch.cjs").bump_patch;

// ── Read hook payload from stdin ────────────────────────────────────────────
let input;
try {
	const raw = fs.readFileSync("/dev/stdin", "utf8");
	input = JSON.parse(raw);
} catch {
	process.exit(0); // can't parse → do nothing
}

const filePath = input?.tool_input?.file_path ?? "";
if (!filePath) process.exit(0);

// ── Guard: skip files outside the project or that would cause loops ────────
const pluginDir = path.resolve(__dirname, "..");
const rel = path.relative(pluginDir, filePath);

const SKIP = [
	"package.json",
	"manifest.json",
];

if (
	!rel ||
	rel.startsWith("..") ||            // outside the project root
	rel.startsWith(".claude") ||       // hook / config files
	SKIP.includes(rel)                 // would cause re-entrant loop
) {
	process.exit(0);
}

bump_patch()
