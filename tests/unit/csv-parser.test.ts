import { describe, it, expect } from "vitest";
import {
	parseCsvLine,
	parseDaylioCsv,
	groupByDay,
	isMoodLevel,
	MOOD_LEVELS,
} from "../../src/main";

// ─── isMoodLevel ────────────────────────────────────────────────────

describe("isMoodLevel", () => {
	it("accepts each of the five valid mood strings", () => {
		for (const mood of MOOD_LEVELS) {
			expect(isMoodLevel(mood)).toBe(true);
		}
	});

	it("rejects empty string", () => {
		expect(isMoodLevel("")).toBe(false);
	});

	it("rejects unrecognised strings", () => {
		expect(isMoodLevel("happy")).toBe(false);
		expect(isMoodLevel("sad")).toBe(false);
		expect(isMoodLevel("neutral")).toBe(false);
	});

	it("is case-sensitive (Daylio CSV is already lowercase)", () => {
		expect(isMoodLevel("Rad")).toBe(false);
		expect(isMoodLevel("GOOD")).toBe(false);
		expect(isMoodLevel("MEH")).toBe(false);
	});
});

// ─── parseCsvLine ───────────────────────────────────────────────────

describe("parseCsvLine", () => {
	it("splits a simple comma-separated line", () => {
		const result = parseCsvLine("a,b,c");
		expect(result).toEqual(["a", "b", "c"]);
	});

	it("handles a quoted field containing a comma", () => {
		const result = parseCsvLine('"hello, world",second,third');
		expect(result).toEqual(["hello, world", "second", "third"]);
	});

	it("handles a quoted field containing an escaped double-quote", () => {
		// CSV spec: "" inside quotes represents a literal "
		const result = parseCsvLine('"say ""hi""",next');
		expect(result).toEqual(['say "hi"', "next"]);
	});

	it("handles empty fields", () => {
		const result = parseCsvLine("a,,c");
		expect(result).toEqual(["a", "", "c"]);
	});

	it("handles a trailing empty field", () => {
		const result = parseCsvLine("a,b,");
		expect(result).toEqual(["a", "b", ""]);
	});

	it("handles a single unquoted field", () => {
		const result = parseCsvLine("only");
		expect(result).toEqual(["only"]);
	});

	it("handles a single quoted-empty field", () => {
		const result = parseCsvLine('""');
		expect(result).toEqual([""]);
	});

	it("handles a multi-word quoted field with no special characters", () => {
		const result = parseCsvLine('"just a phrase",other');
		expect(result).toEqual(["just a phrase", "other"]);
	});

	it("parses the eight Daylio CSV columns correctly", () => {
		const line =
			'2025-01-15,January 15,Wednesday,14:30,good,reading,"Great book",Finished it today';
		const fields = parseCsvLine(line);
		expect(fields[0]).toBe("2025-01-15");
		expect(fields[3]).toBe("14:30");
		expect(fields[4]).toBe("good");
		expect(fields[6]).toBe("Great book");
	});
});

// ─── parseDaylioCsv ─────────────────────────────────────────────────

describe("parseDaylioCsv", () => {
	const HEADER =
		"full_date,date,weekday,time,mood,activities,note_title,note\n";

	it("returns an empty array for an empty string", () => {
		expect(parseDaylioCsv("")).toEqual([]);
	});

	it("returns an empty array for a header-only file", () => {
		expect(parseDaylioCsv(HEADER.trim())).toEqual([]);
	});

	it("parses a single valid entry", () => {
		const csv = HEADER + "2024-03-10,March 10,Sunday,09:00,good,,,\n";
		const result = parseDaylioCsv(csv);
		expect(result).toHaveLength(1);
		expect(result[0]).toMatchObject({
			date: "2024-03-10",
			time: "09:00",
			mood: "good",
		});
	});

	it("parses all five mood levels", () => {
		const rows = [
			"2024-01-01,January 1,Monday,08:00,rad,,,",
			"2024-01-02,January 2,Tuesday,08:00,good,,,",
			"2024-01-03,January 3,Wednesday,08:00,meh,,,",
			"2024-01-04,January 4,Thursday,08:00,bad,,,",
			"2024-01-05,January 5,Friday,08:00,awful,,,",
		].join("\n");
		const result = parseDaylioCsv(HEADER + rows);
		const moods = result.map((e) => e.mood);
		expect(moods).toContain("rad");
		expect(moods).toContain("good");
		expect(moods).toContain("meh");
		expect(moods).toContain("bad");
		expect(moods).toContain("awful");
	});

	it("skips rows with an unrecognised mood", () => {
		const csv =
			HEADER +
			"2024-03-10,March 10,Sunday,09:00,happy,,," +
			"\n2024-03-11,March 11,Monday,10:00,good,,,";
		const result = parseDaylioCsv(csv);
		expect(result).toHaveLength(1);
		expect(result[0]?.mood).toBe("good");
	});

	it("skips rows with a missing date", () => {
		// Simulate a row where the first field is blank
		const csv = HEADER + ",March 10,Sunday,09:00,meh,,,";
		expect(parseDaylioCsv(csv)).toEqual([]);
	});

	it("skips blank lines", () => {
		const csv =
			HEADER +
			"2024-03-10,March 10,Sunday,09:00,meh,,," +
			"\n\n" +
			"2024-03-11,March 11,Monday,10:00,good,,,";
		const result = parseDaylioCsv(csv);
		expect(result).toHaveLength(2);
	});

	it("handles CRLF line endings", () => {
		const csv =
			"full_date,date,weekday,time,mood,activities,note_title,note\r\n" +
			"2024-03-10,March 10,Sunday,09:00,rad,,,\r\n";
		const result = parseDaylioCsv(csv);
		expect(result).toHaveLength(1);
		expect(result[0]?.mood).toBe("rad");
	});

	it("correctly lowercases mood values", () => {
		// Daylio exports are already lowercase, but the parser normalises anyway
		const csv = HEADER + "2024-03-10,March 10,Sunday,09:00,MEH,,,";
		// "MEH" is not a recognised mood level after toLowerCase → skipped
		// (isMoodLevel check uses the lowercased value)
		const result = parseDaylioCsv(csv);
		// "meh" after toLowerCase — but parseDaylioCsv calls .toLowerCase()
		// which produces "meh", which IS a valid level → entry is included
		expect(result).toHaveLength(1);
		expect(result[0]?.mood).toBe("meh");
	});

	it("returns multiple entries for multiple rows on the same date", () => {
		const csv =
			HEADER +
			"2024-06-01,June 1,Saturday,08:00,meh,,," +
			"\n2024-06-01,June 1,Saturday,20:00,good,,,";
		const result = parseDaylioCsv(csv);
		expect(result).toHaveLength(2);
		expect(result.every((e) => e.date === "2024-06-01")).toBe(true);
	});

	it("handles a note column containing commas inside quotes", () => {
		const csv =
			HEADER +
			'2024-03-10,March 10,Sunday,09:00,good,,"My note","Had coffee, tea, and cake"';
		const result = parseDaylioCsv(csv);
		expect(result).toHaveLength(1);
		expect(result[0]?.mood).toBe("good");
	});
});

// ─── groupByDay ─────────────────────────────────────────────────────

describe("groupByDay", () => {
	it("returns an empty array for empty input", () => {
		expect(groupByDay([])).toEqual([]);
	});

	it("groups a single entry into a single day", () => {
		const entry = { date: "2024-01-01", time: "08:00", mood: "good" as const };
		const days = groupByDay([entry]);
		expect(days).toHaveLength(1);
		expect(days[0]?.date).toBe("2024-01-01");
		expect(days[0]?.entries).toHaveLength(1);
	});

	it("groups multiple entries for the same date into one DayData", () => {
		const entries = [
			{ date: "2024-01-01", time: "08:00", mood: "meh" as const },
			{ date: "2024-01-01", time: "20:00", mood: "good" as const },
		];
		const days = groupByDay(entries);
		expect(days).toHaveLength(1);
		expect(days[0]?.entries).toHaveLength(2);
	});

	it("sorts entries within a day by time ascending", () => {
		// Daylio exports newest-first; groupByDay must re-sort within each day.
		const entries = [
			{ date: "2024-01-01", time: "22:00", mood: "awful" as const },
			{ date: "2024-01-01", time: "07:00", mood: "rad" as const },
			{ date: "2024-01-01", time: "14:00", mood: "meh" as const },
		];
		const days = groupByDay(entries);
		const moods = days[0]?.entries.map((e) => e.mood);
		expect(moods).toEqual(["rad", "meh", "awful"]);
	});

	it("sorts days chronologically", () => {
		const entries = [
			{ date: "2024-03-01", time: "08:00", mood: "meh" as const },
			{ date: "2024-01-01", time: "08:00", mood: "good" as const },
			{ date: "2024-02-01", time: "08:00", mood: "rad" as const },
		];
		const days = groupByDay(entries);
		expect(days.map((d) => d.date)).toEqual([
			"2024-01-01",
			"2024-02-01",
			"2024-03-01",
		]);
	});

	it("separates entries on different dates into distinct DayData objects", () => {
		const entries = [
			{ date: "2024-01-01", time: "08:00", mood: "good" as const },
			{ date: "2024-01-02", time: "08:00", mood: "meh" as const },
		];
		const days = groupByDay(entries);
		expect(days).toHaveLength(2);
		expect(days[0]?.date).toBe("2024-01-01");
		expect(days[1]?.date).toBe("2024-01-02");
	});

	it("handles a large number of entries across many dates", () => {
		// Smoke-test with 100 days × 3 entries each.
		const entries = Array.from({ length: 300 }, (_, i) => {
			const dayIndex = Math.floor(i / 3) + 1;
			const dateStr = `2024-01-${String(dayIndex).padStart(2, "0")}`;
			const timeStr = `${String((i % 3) * 8).padStart(2, "0")}:00`;
			return { date: dateStr, time: timeStr, mood: "meh" as const };
		});
		const days = groupByDay(entries);
		expect(days).toHaveLength(100);
		for (const day of days) {
			expect(day.entries).toHaveLength(3);
		}
	});
});
