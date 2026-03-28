import { App, TFile } from "obsidian";
import type { VaultEvent } from "./types";

export const DATE_PREFIX_REGEX = /^(\d{4}-\d{2}-\d{2})/;

/**
 * Scan the vault's metadata cache for notes whose frontmatter
 * contains a `daylio_event` property. The note's filename must
 * begin with YYYY-MM-DD.
 *
 * @param scanDir Optional vault-relative directory to restrict scanning to.
 *                If empty or omitted, the whole vault is scanned.
 */
export function scanVaultEvents(app: App, scanDir?: string): VaultEvent[] {
	const events: VaultEvent[] = [];
	const prefix = scanDir ? scanDir.replace(/\/+$/, "") + "/" : null;
	const files = app.vault.getMarkdownFiles().filter(
		(f) => prefix === null || f.path.startsWith(prefix)
	);

	for (const file of files) {
		const dateMatch = file.basename.match(DATE_PREFIX_REGEX);
		if (!dateMatch?.[1]) continue;

		const cache = app.metadataCache.getFileCache(file);
		const eventValue = cache?.frontmatter?.["daylio_event"];
		if (typeof eventValue !== "string" || eventValue.trim() === "") {
			continue;
		}

		events.push({
			date: dateMatch[1],
			label: eventValue.trim(),
			filePath: file.path,
		});
	}

	return events;
}
