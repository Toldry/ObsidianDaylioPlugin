import { App } from "obsidian";
import type { VaultEvent } from "./types";

export const DATE_PREFIX_REGEX = /^(\d{4}-\d{2}-\d{2})/;
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const DATE_RANGE_REGEX = /^(\d{4}-\d{2}-\d{2})\s*(?:->|\.\.|to)\s*(\d{4}-\d{2}-\d{2})$/;

export interface ParsedEventItem {
	label: string;
	startDate: string;
	endDate?: string;
	isRange?: boolean;
}

/**
 * Parse an event string that might contain pipe range syntax.
 * Examples:
 *   - "Got a cat" -> Point event on defaultStartDate
 *   - "Summer Vacation | 2024-08-12 -> 2024-08-28" -> Range event (Aug 12 - Aug 28)
 *   - "Summer Vacation | 2024-08-28" -> Range event (defaultStartDate -> Aug 28)
 *   - "Cats | Dogs" -> Point event with label "Cats | Dogs" (since "Dogs" is not a date)
 */
export function parseEventString(
	rawStr: string,
	defaultStartDate: string,
	noteEndDate?: string,
): ParsedEventItem {
	const trimmed = rawStr.trim();
	if (!trimmed.includes("|")) {
		const isRange = Boolean(noteEndDate && noteEndDate >= defaultStartDate);
		return {
			label: trimmed,
			startDate: defaultStartDate,
			endDate: isRange ? noteEndDate : undefined,
			isRange,
		};
	}

	const parts = trimmed.split("|").map((p) => p.trim());
	const lastPart = parts[parts.length - 1] ?? "";

	const rangeMatch = lastPart.match(DATE_RANGE_REGEX);
	if (rangeMatch?.[1] && rangeMatch[2]) {
		const label = parts.slice(0, -1).join(" | ").trim();
		const startDate = rangeMatch[1];
		const endDate = rangeMatch[2];
		const isRange = endDate >= startDate;
		return {
			label,
			startDate,
			endDate: isRange ? endDate : undefined,
			isRange,
		};
	}

	if (ISO_DATE_REGEX.test(lastPart)) {
		const label = parts.slice(0, -1).join(" | ").trim();
		const startDate = defaultStartDate;
		const endDate = lastPart;
		const isRange = Boolean(endDate && endDate >= startDate);
		return {
			label,
			startDate,
			endDate: isRange ? endDate : undefined,
			isRange,
		};
	}

	// Last part is not a date/range, treat full string (including pipes) as label
	const isRange = Boolean(noteEndDate && noteEndDate >= defaultStartDate);
	return {
		label: trimmed,
		startDate: defaultStartDate,
		endDate: isRange ? noteEndDate : undefined,
		isRange,
	};
}

/** Auto-detect Obsidian Daily Notes core plugin folder if enabled. */
function getDailyNotesFolder(app: App): string | undefined {
	try {
		const internalPlugins = (app as any).internalPlugins;
		const dailyNotes = internalPlugins?.getPluginById?.("daily-notes");
		if (dailyNotes?.enabled) {
			const folder = dailyNotes?.instance?.options?.folder;
			if (typeof folder === "string" && folder.trim()) {
				return folder.trim();
			}
		}
	} catch {
		// Ignore API errors in mock environment
	}
	return undefined;
}

/**
 * Scan the vault for all dated notes and extract Point and Range Events.
 *
 * @param scanDir Optional vault-relative directory to restrict scanning to.
 *                If empty or omitted, attempts to auto-detect the Daily Notes folder,
 *                otherwise scans the whole vault.
 */
export function scanVaultEvents(app: App, scanDir?: string): VaultEvent[] {
	const events: VaultEvent[] = [];

	let effectiveDir = scanDir?.trim();
	if (!effectiveDir) {
		effectiveDir = getDailyNotesFolder(app);
	}

	const prefix = effectiveDir ? effectiveDir.replace(/\/+$/, "") + "/" : null;
	const files = app.vault.getMarkdownFiles().filter(
		(f) => prefix === null || f.path.startsWith(prefix)
	);

	for (const file of files) {
		const dateMatch = file.basename.match(DATE_PREFIX_REGEX);
		const cache = app.metadataCache.getFileCache(file);
		const frontmatter = cache?.frontmatter;

		const startProp = typeof frontmatter?.["daylio_start"] === "string" && ISO_DATE_REGEX.test(frontmatter["daylio_start"].trim())
			? frontmatter["daylio_start"].trim()
			: undefined;

		const startDate = startProp ?? dateMatch?.[1];
		if (!startDate) continue;

		const noteEndDate = typeof frontmatter?.["daylio_end"] === "string" && ISO_DATE_REGEX.test(frontmatter["daylio_end"].trim())
			? frontmatter["daylio_end"].trim()
			: undefined;

		// Extract raw items from daylio_event and daylio_events (string or array)
		const rawItems: string[] = [];

		const collectItems = (val: unknown): void => {
			if (typeof val === "string" && val.trim()) {
				rawItems.push(val.trim());
			} else if (Array.isArray(val)) {
				for (const item of val) {
					if (typeof item === "string" && item.trim()) {
						rawItems.push(item.trim());
					}
				}
			}
		};

		collectItems(frontmatter?.["daylio_event"]);
		collectItems(frontmatter?.["daylio_events"]);

		if (rawItems.length === 0) {
			// Unlabelled entry marker for column highlight
			events.push({
				date: startDate,
				filePath: file.path,
			});
		} else {
			for (const rawItem of rawItems) {
				const parsed = parseEventString(rawItem, startDate, noteEndDate);
				events.push({
					date: parsed.startDate,
					endDate: parsed.endDate,
					isRange: parsed.isRange,
					label: parsed.label,
					filePath: file.path,
				});
			}
		}
	}

	return events;
}
