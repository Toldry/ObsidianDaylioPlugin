import { App } from "obsidian";
import type { VaultEvent } from "./types";
import { logWarn } from "./log";
import { formatISODate } from "./utils";

/** Matches the YYYY-MM-DD prefix at the start of a filename. */
export const DATE_PREFIX_REGEX = /^(\d{4}-\d{2}-\d{2})/;

/** Matches a standalone ISO date (no surrounding text). */
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/** Matches "YYYY-MM-DD -> YYYY-MM-DD" (or ".." / "to" as separators). */
const DATE_RANGE_REGEX = /^(\d{4}-\d{2}-\d{2})\s*(?:->|\.\.|to)\s*(\d{4}-\d{2}-\d{2})$/;

/** Matches "YYYY-MM-DD -> " (ongoing range with no end date). */
const ONGOING_RANGE_REGEX = /^(\d{4}-\d{2}-\d{2})\s*(?:->|\.\.|to)\s*$/;

/**
 * The result of parsing a `daylio_event` frontmatter value via
 * the pipe-delimited syntax (see {@link parseEventString}).
 */
export interface ParsedEventItem {
	/** Human-readable event label. */
	label: string;
	/** ISO start date (may override the filename date). */
	startDate: string;
	/** ISO end date (only set for valid ranges). */
	endDate?: string;
	/** True when the event spans multiple days. */
	isRange?: boolean;
}

/**
 * Parse an event string that might contain pipe range syntax.
 *
 * Supported formats:
 *   - `"Got a cat"`                              → Point event on defaultStartDate
 *   - `"Summer Vacation | 2024-08-12 -> 2024-08-28"` → Range event (Aug 12–28)
 *   - `"Ongoing Project | 2024-01-01 -> "`       → Range event (Jan 1 → today)
 *   - `"Milestone | 2024-05-14"`                 → Point event on 2024-05-14 (overrides filename)
 *   - `"Cats | Dogs"`                            → Point event with label "Cats | Dogs" (no date after pipe)
 *
 * @param rawStr          - The raw `daylio_event` frontmatter value.
 * @param defaultStartDate - Fallback start date (from filename prefix).
 */
export function parseEventString(
	rawStr: string,
	defaultStartDate: string,
): ParsedEventItem {
	const trimmed = rawStr.trim();
	if (!trimmed.includes("|")) {
		return {
			label: trimmed,
			startDate: defaultStartDate,
		};
	}

	const parts = trimmed.split("|").map((p) => p.trim());
	const lastPart = parts[parts.length - 1] ?? "";

	// "Label | YYYY-MM-DD -> YYYY-MM-DD"
	const rangeMatch = lastPart.match(DATE_RANGE_REGEX);
	if (rangeMatch?.[1] && rangeMatch[2]) {
		const label = parts.slice(0, -1).join(" | ").trim();
		const startDate = rangeMatch[1];
		const endDate = rangeMatch[2];
		if (endDate < startDate) {
			logWarn(
				`Event "${label || rawStr}" has end date (${endDate}) earlier than start date (${startDate}). Treating as point event on ${startDate}.`
			);
			return {
				label,
				startDate,
			};
		}
		return {
			label,
			startDate,
			endDate,
			isRange: true,
		};
	}

	// "Label | YYYY-MM-DD -> " (ongoing — end date defaults to today)
	const ongoingMatch = lastPart.match(ONGOING_RANGE_REGEX);
	if (ongoingMatch?.[1]) {
		const label = parts.slice(0, -1).join(" | ").trim();
		const startDate = ongoingMatch[1];
		const todayStr = formatISODate(new Date());
		if (startDate > todayStr) {
			logWarn(
				`Ongoing event "${label || rawStr}" has start date (${startDate}) in the future (today is ${todayStr}). Treating as point event on ${startDate}.`
			);
			return {
				label,
				startDate,
			};
		}
		return {
			label,
			startDate,
			endDate: todayStr,
			isRange: true,
		};
	}

	// "Label | YYYY-MM-DD" (single date override)
	if (ISO_DATE_REGEX.test(lastPart)) {
		const label = parts.slice(0, -1).join(" | ").trim();
		const startDate = lastPart;
		return {
			label,
			startDate,
		};
	}

	// Last part is not a date/range — treat full string (including pipes) as label
	return {
		label: trimmed,
		startDate: defaultStartDate,
	};
}


/**
 * Try to extract an ISO date string from a frontmatter value.
 * Returns the trimmed date if it's a valid `YYYY-MM-DD` string, or `undefined`.
 */
export function parseFrontmatterDate(value: unknown): string | undefined {
	if (typeof value === "string" && ISO_DATE_REGEX.test(value.trim())) {
		return value.trim();
	}
	return undefined;
}

/**
 * Auto-detect Obsidian Daily Notes core plugin folder if enabled.
 * Falls back to `undefined` when the internal API is unavailable
 * (e.g. in tests) or when the plugin is disabled.
 */
function getDailyNotesFolder(app: App): string | undefined {
	try {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
 * Collect string items from a frontmatter value that may be a string,
 * an array of strings, or something else entirely (in which case
 * nothing is collected).
 */
export function collectStringItems(val: unknown, out: string[]): void {
	if (typeof val === "string" && val.trim()) {
		out.push(val.trim());
	} else if (Array.isArray(val)) {
		for (const item of val) {
			if (typeof item === "string" && item.trim()) {
				out.push(item.trim());
			}
		}
	}
}

/**
 * Scan the vault for all dated notes and extract Point and Range Events.
 *
 * @param app     - The Obsidian App instance.
 * @param scanDir - Optional vault-relative directory to restrict scanning to.
 *                  If empty or omitted, attempts to auto-detect the Daily Notes folder,
 *                  otherwise scans the whole vault.
 * @returns Array of VaultEvent objects (one per labelled event, plus unlabelled
 *          entries for dated notes without a `daylio_event` field).
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
		const startDate = dateMatch?.[1];
		if (!startDate) continue;

		const cache = app.metadataCache.getFileCache(file);
		const frontmatter = cache?.frontmatter;

		// Extract raw items from daylio_event and daylio_events (string or array)
		const rawItems: string[] = [];
		collectStringItems(frontmatter?.["daylio_event"], rawItems);
		collectStringItems(frontmatter?.["daylio_events"], rawItems);

		if (rawItems.length === 0) {
			// Unlabelled entry marker for column highlight
			events.push({
				date: startDate,
				filePath: file.path,
			});
		} else {
			for (const rawItem of rawItems) {
				const parsed = parseEventString(rawItem, startDate);
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
