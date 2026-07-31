import { MOOD_LEVELS, type MoodLevel, type MoodEntry, type DayData } from "./types";

/**
 * Parse a Daylio CSV export into an array of MoodEntry objects.
 *
 * Expected columns (in order):
 *   full_date, date, weekday, time, mood, activities, note_title, note
 *
 * We only care about full_date (YYYY-MM-DD), time, and mood.
 */
export function parseDaylioCsv(raw: string): MoodEntry[] {
	const lines = raw.split(/\r?\n/).filter((line) => line.trim() !== "");
	if (lines.length < 2) {
		return [];
	}

	const entries: MoodEntry[] = [];
	for (let i = 1; i < lines.length; i++) {
		const fields = parseCsvLine(lines[i] ?? "");
		const fullDate = fields[0]?.trim();
		const time = fields[3]?.trim() ?? "";
		const moodRaw = fields[4]?.trim().toLowerCase() ?? "";

		if (!fullDate || !isMoodLevel(moodRaw)) {
			continue;
		}

		entries.push({ date: fullDate, time, mood: moodRaw });
	}
	return entries;
}

/**
 * Minimal CSV line parser that respects quoted fields
 * (Daylio's "note" column can contain commas and newlines).
 */
export function parseCsvLine(line: string): string[] {
	const result: string[] = [];
	let current = "";
	let inQuotes = false;

	for (let i = 0; i < line.length; i++) {
		const char = line[i];
		if (inQuotes) {
			if (char === '"') {
				if (i + 1 < line.length && line[i + 1] === '"') {
					current += '"';
					i++;
				} else {
					inQuotes = false;
				}
			} else {
				current += char;
			}
		} else {
			if (char === '"') {
				inQuotes = true;
			} else if (char === ",") {
				result.push(current);
				current = "";
			} else {
				current += char;
			}
		}
	}
	result.push(current);
	return result;
}

export function isMoodLevel(value: string): value is MoodLevel {
	return MOOD_LEVELS.includes(value as MoodLevel);
}

/**
 * Group entries by date and sort days chronologically.
 * Within each day, entries are sorted by time ascending.
 */
export function groupByDay(entries: MoodEntry[]): DayData[] {
	// log("groupByDay: grouping", entries.length, "entries");
	const map = new Map<string, MoodEntry[]>();
	for (const entry of entries) {
		const existing = map.get(entry.date);
		if (existing) {
			existing.push(entry);
		} else {
			map.set(entry.date, [entry]);
		}
	}

	const days: DayData[] = [];
	for (const [date, dayEntries] of map) {
		dayEntries.sort((a, b) => a.time.localeCompare(b.time));
		days.push({ date, entries: dayEntries });
	}

	days.sort((a, b) => a.date.localeCompare(b.date));
	// log("groupByDay: result is", days.length, "unique days");
	return days;
}
