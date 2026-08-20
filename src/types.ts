import { addIcon } from "obsidian";
import DAYLIO_FACE_SVG from "./daylio-face.svg";

// ─── Custom ribbon icon ──────────────────────────────────────────────

/** Obsidian icon ID registered via `addIcon()` for the ribbon button. */
const DAYLIO_ICON_ID = "daylio-face";
// addIcon expects the inner HTML of an <svg> element, not the full document.
const svgInner = DAYLIO_FACE_SVG.match(/<svg[^>]*>([\s\S]*)<\/svg>/i)?.[1] ?? DAYLIO_FACE_SVG;
addIcon(DAYLIO_ICON_ID, svgInner);

export { DAYLIO_ICON_ID };

// ─── Types ──────────────────────────────────────────────────────────

/** The five mood levels Daylio uses, ranked worst → best. */
export type MoodLevel = "awful" | "bad" | "meh" | "good" | "rad";

/**
 * Ordered list of all valid mood levels.
 * Declared `as const` so the array is a readonly tuple whose element
 * type narrows to the `MoodLevel` union automatically.
 */
export const MOOD_LEVELS = ["awful", "bad", "meh", "good", "rad"] as const;

/** A single mood entry parsed from one row of the Daylio CSV export. */
export interface MoodEntry {
	/** ISO date string, e.g. "2024-03-15". */
	date: string;
	/** Time of day, e.g. "14:30". */
	time: string;
	/** The mood level recorded for this entry. */
	mood: MoodLevel;
}

/** A single day, potentially with multiple mood entries. */
export interface DayData {
	/** ISO date string for this day. */
	date: string;
	/** All mood entries recorded on this day, sorted by time ascending. */
	entries: MoodEntry[];
}

/**
 * A dated vault note that annotates the graph.
 *
 * Every note whose filename begins with YYYY-MM-DD produces a
 * VaultEvent.  The optional `label` is only present when the note's
 * frontmatter contains a non-empty `daylio_event` field — notes
 * without that field still receive a column highlight on the graph
 * but do not display a text label.
 */
export interface VaultEvent {
	/** ISO date string — start date or point-event date. */
	date: string;
	/** ISO date string — set when event spans across a date range. */
	endDate?: string;
	/** Human-readable label; only set when `daylio_event` frontmatter is present. */
	label?: string;
	/** Vault-relative path so we can navigate to it. */
	filePath: string;
	/** True when `endDate` is present and `endDate >= date`. */
	isRange?: boolean;
}

// ─── Default colours (matching the Daylio palette) ──────────────────

/** Default mood colour hex values matching the official Daylio palette. */
export const DEFAULT_MOOD_COLORS: Readonly<Record<MoodLevel, string>> = {
	rad: "#f78c1e",
	good: "#41a766",
	meh: "#9056a3",
	bad: "#5579a7",
	awful: "#6a777c",
} as const;

// ─── Settings ───────────────────────────────────────────────────────

/** Persisted plugin settings stored in `.obsidian/plugins/daylio-mood-graph/data.json`. */
export interface DaylioGraphSettings {
	/** Vault-relative path to the Daylio CSV export file. */
	csvPath: string;
	/** Hex colour for each mood level. */
	moodColors: Record<MoodLevel, string>;
	/** Pixel width of each bar column — controls zoom level. */
	barWidth: number;
	/** Vault-relative subdirectory to scan for event notes. Empty string = scan whole vault. */
	eventScanDir: string;
	/** Whether to render the floating event label cards below the graph. */
	showEventLabels: boolean;
}

/** Factory defaults applied when no saved settings exist yet. */
export const DEFAULT_SETTINGS: DaylioGraphSettings = {
	csvPath: "",
	moodColors: { ...DEFAULT_MOOD_COLORS },
	barWidth: 8,
	eventScanDir: "",
	showEventLabels: true,
};

/**
 * Minimal interface for any object that holds plugin settings.
 * Used by graph-view and settings-tab to avoid importing the
 * concrete plugin class (which would create circular deps).
 */
export interface HasDaylioSettings {
	settings: DaylioGraphSettings;
	saveSettings(): Promise<void>;
	manifest: { version: string };
}

// ─── Zoom / bar-width constraints ───────────────────────────────────

/** Minimum bar width in pixels (slider + stepZoom lower bound). */
export const BAR_WIDTH_MIN = 0.25;
/** Maximum bar width in pixels (slider + stepZoom upper bound). */
export const BAR_WIDTH_MAX = 8;
/** Increment used by the ± zoom buttons and the slider step attribute. */
export const BAR_WIDTH_STEP = 0.25;
/** barWidth threshold below which Ctrl+wheel uses the finer step. */
export const BAR_WIDTH_FINE_THRESHOLD = 2;
/** Ctrl+wheel zoom step when barWidth ≤ BAR_WIDTH_FINE_THRESHOLD.
 *  Matches BAR_WIDTH_STEP so one scroll notch equals one ± button press. */
export const BAR_WIDTH_FINE_STEP = 0.25;
/** Ctrl+wheel zoom step when barWidth > BAR_WIDTH_FINE_THRESHOLD. */
export const BAR_WIDTH_COARSE_STEP = 0.5;
/** Bar width at or below which only year-start labels are shown on the graph;
 *  month labels would be too crowded at this zoom level. */
export const BAR_WIDTH_YEAR_ONLY_THRESHOLD = 0.5;

// ─── Layout helpers ─────────────────────────────────────────────────

/** Obsidian view type identifier — must match the CSS attribute selector
 *  `[data-type="daylio-mood-graph-view"]` in styles.css. */
export const VIEW_TYPE_DAYLIO = "daylio-mood-graph-view";


/**
 * Maps each mood level to its vertical lane index in the graph.
 * Lane 0 = top = "rad" (best mood), lane 4 = bottom = "awful" (worst mood).
 */
export const MOOD_TO_LANE: Readonly<Record<MoodLevel, number>> = {
	rad: 0,
	good: 1,
	meh: 2,
	bad: 3,
	awful: 4,
} as const;

// ─── DOM event constants ────────────────────────────────────────────

/**
 * Standard `MouseEvent.button` numeric codes.
 */
export const MouseButton = {
	Main: 0,
	Auxiliary: 1,
	Secondary: 2,
} as const;


