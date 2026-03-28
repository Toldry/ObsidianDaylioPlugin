import { addIcon } from "obsidian";

// ─── Custom ribbon icon ──────────────────────────────────────────────
const DAYLIO_ICON_ID = "daylio-face";
addIcon(
	DAYLIO_ICON_ID,
	`<circle cx="50" cy="50" r="48" fill="#4CAF50"/>
	 <circle cx="36" cy="40" r="7" fill="#1a1a1a"/>
	 <circle cx="64" cy="40" r="7" fill="#1a1a1a"/>
	 <path d="M30 60 Q50 80 70 60"
	       stroke="#1a1a1a" stroke-width="7"
	       fill="none" stroke-linecap="round"/>`
);

export { DAYLIO_ICON_ID };

// ─── Types ──────────────────────────────────────────────────────────

/** The five mood levels Daylio uses, ranked worst → best. */
export type MoodLevel = "awful" | "bad" | "meh" | "good" | "rad";

export const MOOD_LEVELS: MoodLevel[] = ["awful", "bad", "meh", "good", "rad"];

export interface MoodEntry {
	date: string;       // "YYYY-MM-DD"
	time: string;       // "HH:MM"
	mood: MoodLevel;
}

/** A single day, potentially with multiple mood entries. */
export interface DayData {
	date: string;
	entries: MoodEntry[];
}

/** An event label sourced from a vault note's frontmatter. */
export interface VaultEvent {
	date: string;       // "YYYY-MM-DD"
	label: string;
	filePath: string;   // path inside vault so we can navigate to it
}

// ─── Default colours (matching the Daylio palette) ──────────────────

export const DEFAULT_MOOD_COLORS: Record<MoodLevel, string> = {
	rad: "#f78c1e",
	good: "#41a766",
	meh: "#9056a3",
	bad: "#5579a7",
	awful: "#6a777c",
};

// ─── Settings ───────────────────────────────────────────────────────

export interface DaylioGraphSettings {
	csvPath: string;
	moodColors: Record<MoodLevel, string>;
	/** Pixel width of each bar column — controls zoom level. */
	barWidth: number;
}

export const DEFAULT_SETTINGS: DaylioGraphSettings = {
	csvPath: "",
	moodColors: { ...DEFAULT_MOOD_COLORS },
	barWidth: 8,
};

/**
 * Minimal interface for any object that holds plugin settings.
 * Used by graph-view and settings-tab to avoid importing the
 * concrete plugin class (which would create circular deps).
 */
export interface HasDaylioSettings {
	settings: DaylioGraphSettings;
	saveSettings(): Promise<void>;
}

// ─── Layout helpers ─────────────────────────────────────────────────

export const VIEW_TYPE_DAYLIO = "daylio-mood-graph-view";

/**
 * Gap between bar columns, in pixels.  Shrinks at extreme zoom-out so
 * the gap doesn't dominate over the bars themselves.
 */
export function barGapFor(barWidth: number): number {
	return barWidth >= 2 ? 2 : barWidth >= 1 ? 1 : 0;
}

/** Lane 0 = top = "rad" (best mood). */
export const MOOD_TO_LANE: Record<MoodLevel, number> = {
	rad: 0,
	good: 1,
	meh: 2,
	bad: 3,
	awful: 4,
};
