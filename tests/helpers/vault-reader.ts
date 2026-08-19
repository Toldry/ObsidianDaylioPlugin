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

import { parseEventString, parseFrontmatterDate, collectStringItems } from "../../src/main";

export interface VaultEventOnDisk {
	date: string;
	endDate?: string;
	isRange?: boolean;
	label?: string;  // only present when daylio_event frontmatter is set
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
): Record<string, string | string[]> | null {
	const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	if (!match?.[1]) return null;

	const result: Record<string, string | string[]> = {};
	let currentKey = "";

	for (const rawLine of match[1].split(/\r?\n/)) {
		const trimmedLine = rawLine.trim();
		if (!trimmedLine) continue;

		if (trimmedLine.startsWith("- ") && currentKey) {
			let itemVal = trimmedLine.slice(2).trim();
			if (itemVal.startsWith('"') && itemVal.endsWith('"')) {
				itemVal = itemVal.slice(1, -1).replace(/""/g, '"');
			}
			const existing = result[currentKey];
			if (Array.isArray(existing)) {
				existing.push(itemVal);
			} else {
				result[currentKey] = [itemVal];
			}
			continue;
		}

		const colonIdx = rawLine.indexOf(":");
		if (colonIdx === -1) continue;

		const key = rawLine.slice(0, colonIdx).trim();
		let value = rawLine.slice(colonIdx + 1).trim();
		currentKey = key;

		if (value) {
			if (value.startsWith('"') && value.endsWith('"')) {
				value = value.slice(1, -1).replace(/""/g, '"');
			}
			result[key] = value;
		}
	}
	return Object.keys(result).length > 0 ? result : null;
}

/**
 * Scan the top-level markdown files in `vaultPath` and return vault entries
 * following the same rules as scanVaultEvents():
 *
 *  - Filename must start with YYYY-MM-DD.
 *  - All such files are included; `label` is only set when `daylio_event`
 *    frontmatter is a non-empty string.
 *  - Returned in alphabetical filename order (deterministic for tests).
 *  - Duplicate dates produce multiple entries (matching plugin behaviour).
 */
export function readVaultEventsFromDisk(
	vaultPath: string
): VaultEventOnDisk[] {
	const events: VaultEventOnDisk[] = [];

	function collectFiles(dir: string): string[] {
		const result: string[] = [];
		const entries = fs.readdirSync(dir, { withFileTypes: true });
		for (const entry of entries) {
			const fullPath = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				result.push(...collectFiles(fullPath));
			} else if (entry.isFile() && entry.name.endsWith(".md")) {
				result.push(fullPath);
			}
		}
		return result;
	}

	const filePaths = collectFiles(vaultPath).sort();

	for (const filePath of filePaths) {
		const filename = path.basename(filePath);
		const basename = filename.replace(/\.md$/, "");
		const dateMatch = basename.match(DATE_PREFIX_RE);
		if (!dateMatch?.[1]) continue;

		const content = fs.readFileSync(filePath, "utf8");
		const frontmatter = parseFrontmatter(content);

		const rawItems: string[] = [];
		collectStringItems(frontmatter?.["daylio_event"], rawItems);
		collectStringItems(frontmatter?.["daylio_events"], rawItems);

		if (rawItems.length === 0) {
			events.push({
				date: dateMatch[1],
				filePath,
			});
		} else {
			const noteEndDate = parseFrontmatterDate(frontmatter?.["daylio_end"]);
			for (const item of rawItems) {
				const parsed = parseEventString(item, dateMatch[1], noteEndDate);
				events.push({
					date: parsed.startDate,
					endDate: parsed.endDate,
					isRange: parsed.isRange,
					label: parsed.label,
					filePath,
				});
			}
		}
	}

	return events;
}
