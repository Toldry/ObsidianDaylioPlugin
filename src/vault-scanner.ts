import { App, TFile } from "obsidian";
import type { VaultEvent } from "./types";
import log from "./log";

export const DATE_PREFIX_REGEX = /^(\d{4}-\d{2}-\d{2})/;

/**
 * Scan the vault for all notes whose filename begins with YYYY-MM-DD.
 * Every such note produces a VaultEvent (a column highlight on the graph).
 * Notes that also have a non-empty `daylio_event` frontmatter field receive
 * a `label`, which is displayed as a floating annotation.
 *
 * @param scanDir Optional vault-relative directory to restrict scanning to.
 *                If empty or omitted, the whole vault is scanned.
 */
export function scanVaultEvents(app: App, scanDir?: string): VaultEvent[] {
	// log(
	// 	"scanVaultEvents: scanning",
	// 	scanDir ? `directory "${scanDir}"` : "whole vault",
	// );
	const events: VaultEvent[] = [];
	const prefix = scanDir ? scanDir.replace(/\/+$/, "") + "/" : null;
	const files = app.vault.getMarkdownFiles().filter(
		(f) => prefix === null || f.path.startsWith(prefix)
	);
	// log("scanVaultEvents: examining", files.length, "markdown files");

	for (const file of files) {
		const dateMatch = file.basename.match(DATE_PREFIX_REGEX);
		if (!dateMatch?.[1]) continue;

		const cache = app.metadataCache.getFileCache(file);
		const eventValue = cache?.frontmatter?.["daylio_event"];
		const label =
			typeof eventValue === "string" && eventValue.trim()
				? eventValue.trim()
				: undefined;

		if (label) {
			// log("scanVaultEvents: labelled entry:", dateMatch[1], "→", label);
		} else {
			// log("scanVaultEvents: unlabelled entry:", dateMatch[1]);
		}

		events.push({
			date: dateMatch[1],
			label,
			filePath: file.path,
		});
	}

	// log("scanVaultEvents: total entries found:", events.length);
	return events;
}
