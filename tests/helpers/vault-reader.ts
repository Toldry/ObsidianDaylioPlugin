/**
 * Filesystem-based vault reader for integration tests.
 *
 * Mirrors the logic of scanVaultEvents() from src/main.ts, but reads
 * markdown files directly from disk using Node.js `fs` instead of through
 * Obsidian's metadataCache API.  This lets integration tests verify the
 * same event-detection logic against the real test-vault files without
 * needing an Obsidian runtime.
 */

import fs from "fs";
import path from "path";

export interface VaultEventOnDisk {
	date: string;
	label: string;
	filePath: string;
}

const DATE_PREFIX_RE = /^(\d{4}-\d{2}-\d{2})/;

/**
 * Parse the YAML frontmatter block from a markdown file's raw content.
 * Returns a flat key→value map for the simple scalar fields we care about,
 * or null if no frontmatter is present.
 *
 * This intentionally handles only the subset of YAML used in the test
 * vault notes (bare strings and double-quoted strings).  A full YAML
 * parser is not needed for the plugin's single-field convention.
 */
export function parseFrontmatter(
	content: string
): Record<string, string> | null {
	const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	if (!match?.[1]) return null;

	const result: Record<string, string> = {};
	for (const rawLine of match[1].split(/\r?\n/)) {
		const colonIdx = rawLine.indexOf(":");
		if (colonIdx === -1) continue;

		const key = rawLine.slice(0, colonIdx).trim();
		let value = rawLine.slice(colonIdx + 1).trim();

		// Strip surrounding double-quotes (YAML bare strings need none).
		if (value.startsWith('"') && value.endsWith('"')) {
			value = value.slice(1, -1).replace(/""/g, '"');
		}

		result[key] = value;
	}
	return Object.keys(result).length > 0 ? result : null;
}

/**
 * Scan the top-level markdown files in `vaultPath` and return vault events
 * following the same rules as scanVaultEvents():
 *
 *  - Filename must start with YYYY-MM-DD.
 *  - `daylio_event` frontmatter field must be a non-empty string.
 *  - Returned in alphabetical filename order (deterministic for tests).
 *  - Duplicate dates produce multiple entries (matching plugin behaviour).
 */
export function readVaultEventsFromDisk(
	vaultPath: string
): VaultEventOnDisk[] {
	const events: VaultEventOnDisk[] = [];

	const filenames = fs
		.readdirSync(vaultPath)
		.filter((name) => name.endsWith(".md"))
		.sort(); // alphabetical → deterministic order

	for (const filename of filenames) {
		const basename = filename.replace(/\.md$/, "");
		const dateMatch = basename.match(DATE_PREFIX_RE);
		if (!dateMatch?.[1]) continue;

		const filePath = path.join(vaultPath, filename);
		const content = fs.readFileSync(filePath, "utf8");
		const frontmatter = parseFrontmatter(content);

		const eventValue = frontmatter?.["daylio_event"];
		if (typeof eventValue !== "string" || eventValue.trim() === "") {
			continue;
		}

		events.push({
			date: dateMatch[1],
			label: eventValue.trim(),
			filePath,
		});
	}

	return events;
}
