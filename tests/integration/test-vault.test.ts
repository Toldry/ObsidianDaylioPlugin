/**
 * Integration tests — real files, real data.
 *
 * These tests read the actual CSV and markdown files from the test vault
 * and verify that the plugin's parsing and event-detection logic behaves
 * correctly end-to-end.
 *
 * Tests are read-only; they never modify vault files.
 */

import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import path from "path";
import {
	parseDaylioCsv,
	groupByDay,
	type MoodEntry,
	type DayData,
} from "../../src/main";
import {
	readVaultEventsFromDisk,
	parseFrontmatter,
	type VaultEventOnDisk,
} from "../helpers/vault-reader";

const VAULT_ROOT = path.resolve(
	__dirname,
	"../../daylio_plugin_test_vault"
);
const CSV_PATH = path.join(VAULT_ROOT, "attachments", "daylio_export.csv");
// Dated notes live in a dedicated sub-directory, not at the vault root.
const ENTRIES_DIR = path.join(VAULT_ROOT, "entries");

// ─── Frontmatter parser unit tests ──────────────────────────────────
// parseFrontmatter lives in a test helper, but it's complex enough to
// warrant its own assertions before the integration tests rely on it.

describe("parseFrontmatter (helper)", () => {
	it("extracts a double-quoted string value", () => {
		const md = '---\ndaylio_event: "Started new job"\n---\nBody text.';
		const fm = parseFrontmatter(md);
		expect(fm?.["daylio_event"]).toBe("Started new job");
	});

	it("extracts an unquoted string value", () => {
		const md = "---\ndaylio_event: Anthropic founded\n---\nBody.";
		const fm = parseFrontmatter(md);
		expect(fm?.["daylio_event"]).toBe("Anthropic founded");
	});

	it("extracts multiple keys", () => {
		const md = "---\ntitle: My note\ntags: journal\n---\n";
		const fm = parseFrontmatter(md);
		expect(fm?.["title"]).toBe("My note");
		expect(fm?.["tags"]).toBe("journal");
	});

	it("returns null when there is no frontmatter block", () => {
		const md = "# Just a heading\n\nNo frontmatter here.";
		expect(parseFrontmatter(md)).toBeNull();
	});

	it("handles an empty frontmatter block", () => {
		const md = "---\n---\nBody.";
		expect(parseFrontmatter(md)).toBeNull();
	});

	it("handles CRLF line endings inside the frontmatter block", () => {
		const md = "---\r\ndaylio_event: \"Got a cat\"\r\n---\r\nBody.";
		const fm = parseFrontmatter(md);
		expect(fm?.["daylio_event"]).toBe("Got a cat");
	});
});

// ─── CSV integration ─────────────────────────────────────────────────

describe("CSV integration (test vault — example_daylio_data.csv)", () => {
	let csvText: string;
	let allEntries: MoodEntry[];
	let allDays: DayData[];

	beforeAll(() => {
		csvText = fs.readFileSync(CSV_PATH, "utf8");
		allEntries = parseDaylioCsv(csvText);
		allDays = groupByDay(allEntries);
	});

	it("CSV file exists and is non-empty", () => {
		expect(csvText.length).toBeGreaterThan(0);
	});

	it("parses the expected total number of mood entries", () => {
		// The test CSV has 2910 data rows (header excluded).
		expect(allEntries).toHaveLength(2910);
	});

	it("has the expected mood distribution", () => {
		const counts = { rad: 0, good: 0, meh: 0, bad: 0, awful: 0 };
		for (const entry of allEntries) counts[entry.mood]++;
		expect(counts.good).toBe(1702);
		expect(counts.meh).toBe(748);
		expect(counts.bad).toBe(218);
		expect(counts.rad).toBe(197);
		expect(counts.awful).toBe(45);
	});

	it("every parsed entry has a valid date, time, and mood", () => {
		const dateRe = /^\d{4}-\d{2}-\d{2}$/;
		const timeRe = /^\d{2}:\d{2}$/;
		for (const entry of allEntries) {
			expect(entry.date).toMatch(dateRe);
			expect(entry.time).toMatch(timeRe);
			expect(["rad", "good", "meh", "bad", "awful"]).toContain(
				entry.mood
			);
		}
	});

	it("earliest entry is 2019-02-15", () => {
		const sorted = [...allEntries].sort((a, b) =>
			a.date.localeCompare(b.date)
		);
		expect(sorted[0]?.date).toBe("2019-02-15");
	});

	it("most recent entry is 2025-04-01", () => {
		const sorted = [...allEntries].sort((a, b) =>
			b.date.localeCompare(a.date)
		);
		expect(sorted[0]?.date).toBe("2025-04-01");
	});

	it("groups entries spanning roughly 6 years into the correct day count", () => {
		// 2019-02-15 → 2025-04-01 is 2236 calendar days, but not every
		// calendar day has a Daylio entry.  The grouped count must be ≤ the
		// span and high enough to represent years of data.
		expect(allDays.length).toBeGreaterThan(1500);
		expect(allDays.length).toBeLessThanOrEqual(2240);
	});

	it("2025-03-28 has one entry with mood bad (known anchor point)", () => {
		const day = allDays.find((d) => d.date === "2025-03-28");
		expect(day).toBeDefined();
		expect(day?.entries).toHaveLength(1);
		expect(day?.entries[0]?.mood).toBe("bad");
	});

	it("2025-03-29 has one entry with mood good", () => {
		const day = allDays.find((d) => d.date === "2025-03-29");
		expect(day?.entries[0]?.mood).toBe("good");
	});

	it("2025-03-27 has two entries, both meh, sorted by time", () => {
		const day = allDays.find((d) => d.date === "2025-03-27");
		expect(day?.entries).toHaveLength(2);
		expect(day?.entries.every((e) => e.mood === "meh")).toBe(true);
		// Entries must be time-sorted ascending (lexicographic on "HH:MM")
		const times = day?.entries.map((e) => e.time) ?? [];
		const sorted = [...times].sort();
		expect(times).toEqual(sorted);
	});

	it("2019-02-16 has two entries (meh and good)", () => {
		const day = allDays.find((d) => d.date === "2019-02-16");
		expect(day?.entries).toHaveLength(2);
		const moods = day?.entries.map((e) => e.mood) ?? [];
		expect(moods).toContain("meh");
		expect(moods).toContain("good");
	});

	it("no day in the grouped data contains zero entries", () => {
		for (const day of allDays) {
			expect(day.entries.length).toBeGreaterThan(0);
		}
	});

	it("days are in strict chronological order after grouping", () => {
		for (let i = 1; i < allDays.length; i++) {
			expect(allDays[i]!.date > allDays[i - 1]!.date).toBe(true);
		}
	});
});

// ─── Vault event integration ──────────────────────────────────────────

describe("Vault events integration (test vault notes)", () => {
	let events: VaultEventOnDisk[];
	// Map from date → event (mirrors what renderGraph builds)
	let eventsByDate: Map<string, VaultEventOnDisk>;

	beforeAll(() => {
		events = readVaultEventsFromDisk(ENTRIES_DIR);
		eventsByDate = new Map();
		// Last-writer wins — same logic as the plugin's renderGraph()
		for (const event of events) {
			eventsByDate.set(event.date, event);
		}
	});

	// ── Notes that SHOULD produce events ────────────────────────────

	it("detects the 'Started new job' event on 2019-04-15", () => {
		expect(eventsByDate.get("2019-04-15")?.label).toBe("Started new job");
	});

	it("detects the 'Moved flats' event on 2019-09-02", () => {
		expect(eventsByDate.get("2019-09-02")?.label).toBe("Moved flats");
	});

	it("detects the 'Lockdown begins' event on 2020-03-16", () => {
		expect(eventsByDate.get("2020-03-16")?.label).toBe("Lockdown begins");
	});

	it("detects the 'US election night' event on 2020-11-03", () => {
		expect(eventsByDate.get("2020-11-03")?.label).toBe("US election night");
	});

	it("detects an 'Anthropic founded' event on 2021-03-01", () => {
		// Two notes share this date; both carry the same label.
		expect(eventsByDate.get("2021-03-01")?.label).toBe(
			"Anthropic founded"
		);
	});

	it("detects the 'Started therapy' event on 2021-09-06", () => {
		expect(eventsByDate.get("2021-09-06")?.label).toBe("Started therapy");
	});

	it("detects the 'Sister's wedding' event on 2022-05-14", () => {
		expect(eventsByDate.get("2022-05-14")?.label).toBe("Sister's wedding");
	});

	it("detects the 'Quit job' event on 2022-10-01", () => {
		expect(eventsByDate.get("2022-10-01")?.label).toBe("Quit job");
	});

	it("detects some event on 2023-03-15 (two notes, non-deterministic winner)", () => {
		const label = eventsByDate.get("2023-03-15")?.label ?? "";
		expect(["Claude released to public", "Released to public"]).toContain(
			label
		);
	});

	it("detects the 'Holiday in Portugal' event on 2023-07-22", () => {
		expect(eventsByDate.get("2023-07-22")?.label).toBe(
			"Holiday in Portugal"
		);
	});

	it("detects the 'Took up running' event on 2024-01-08", () => {
		expect(eventsByDate.get("2024-01-08")?.label).toBe("Took up running");
	});

	it("detects the 'Got a cat' event on 2024-09-30", () => {
		expect(eventsByDate.get("2024-09-30")?.label).toBe("Got a cat");
	});

	it("detects the 'New Year 2025' event on 2025-01-01", () => {
		expect(eventsByDate.get("2025-01-01")?.label).toBe("New Year 2025");
	});

	it("detects the 'Got promoted' event on 2025-03-10", () => {
		expect(eventsByDate.get("2025-03-10")?.label).toBe("Got promoted");
	});

	// ── Notes that MUST NOT produce events ──────────────────────────

	it("excludes the note with an empty daylio_event (2020-07-04)", () => {
		// daylio_event: "" → excluded
		expect(eventsByDate.has("2020-07-04")).toBe(false);
	});

	it("excludes dated notes that have no daylio_event frontmatter key", () => {
		// 2022-08-19 Random Journal Entry — no daylio_event
		expect(eventsByDate.has("2022-08-19")).toBe(false);
		// 2023-11-05 Film Review — no daylio_event
		expect(eventsByDate.has("2023-11-05")).toBe(false);
		// 2024-06-03 Reading Notes — no daylio_event
		expect(eventsByDate.has("2024-06-03")).toBe(false);
	});

	it("excludes notes whose filenames do not begin with a date", () => {
		// "Meeting Notes - March Sprint" and "Ideas and Scratchpad"
		// Use path.basename so the check is path-separator-agnostic
		// (Windows uses backslashes; forward-slash regex would fail there).
		const nonDatePaths = events
			.map((e) => e.filePath)
			.filter((fp) => !/^\d{4}-\d{2}-\d{2}/.test(path.basename(fp)));
		expect(nonDatePaths).toHaveLength(0);
	});

	// ── Edge-case behaviour ─────────────────────────────────────────

	it("includes the invalid-date note (2024-13-45) in raw events", () => {
		// The regex /^(\d{4}-\d{2}-\d{2})/ matches the filename pattern even
		// for a semantically invalid date.  The event IS returned by the
		// scanner — it just won't appear on the graph because no mood entry
		// exists for that date in the CSV.  This is intentional: the plugin
		// silently drops events whose dates have no bar to attach to.
		const rawEvent = events.find((e) => e.date === "2024-13-45");
		expect(rawEvent).toBeDefined();
		expect(rawEvent?.label).toBe("Should be ignored — invalid date");
	});

	it("two notes sharing 2021-03-01 produce two raw events (pre-dedup)", () => {
		const duplicates = events.filter((e) => e.date === "2021-03-01");
		expect(duplicates).toHaveLength(2);
	});

	it("two notes sharing 2023-03-15 produce two raw events (pre-dedup)", () => {
		const duplicates = events.filter((e) => e.date === "2023-03-15");
		expect(duplicates).toHaveLength(2);
	});

	it("each raw event has a non-empty label and a filePath ending in .md", () => {
		for (const event of events) {
			expect(event.label.trim().length).toBeGreaterThan(0);
			expect(event.filePath).toMatch(/\.md$/);
		}
	});

	it("each event's filePath points to a file that actually exists on disk", () => {
		for (const event of events) {
			expect(fs.existsSync(event.filePath)).toBe(true);
		}
	});
});

// ─── Date range mismatch ──────────────────────────────────────────────
//
// The plugin renders a bar only for dates present in the CSV.  A vault
// event whose date does not appear in the CSV therefore has no bar to
// attach to and is silently ignored by the graph builder.
//
// The important contract being verified here is:
//
//   1. The scanner (readVaultEventsFromDisk / scanVaultEvents) is
//      date-agnostic: it returns every valid event regardless of whether
//      a matching DayData exists in the CSV.
//
//   2. The CSV parser (parseDaylioCsv + groupByDay) is also date-agnostic
//      in the opposite direction: it never synthesises DayData for dates
//      not present in the file.
//
//   3. Therefore the "drop silently" behaviour emerges purely from the
//      graph builder's lookup (eventsByDate.get(day.date)), with no
//      special-casing needed in either parser.
//
// Two anchor notes in entries/ exercise the two boundary cases:
//   2018-12-25 Before CSV Range.md  — date precedes the CSV start (2019-02-15)
//   2025-12-31 After CSV Range.md   — date follows the CSV end   (2025-04-01)

describe("Date range mismatch — events outside the CSV date span", () => {
	// Dates of the two purpose-built anchor notes.
	const BEFORE_RANGE_DATE = "2018-12-25";
	const AFTER_RANGE_DATE = "2025-12-31";

	// CSV boundaries confirmed by the "earliest / most recent entry" tests above.
	const CSV_FIRST_DATE = "2019-02-15";
	const CSV_LAST_DATE = "2025-04-01";

	let allDays: DayData[];
	let csvDateSet: Set<string>;
	let rangeEvents: VaultEventOnDisk[];

	beforeAll(() => {
		const csvText = fs.readFileSync(CSV_PATH, "utf8");
		allDays = groupByDay(parseDaylioCsv(csvText));
		csvDateSet = new Set(allDays.map((d) => d.date));
		rangeEvents = readVaultEventsFromDisk(ENTRIES_DIR);
	});

	// ── Verify the anchor notes were written correctly ───────────────

	it("the before-range anchor note produces a raw event with the expected date and label", () => {
		const event = rangeEvents.find((e) => e.date === BEFORE_RANGE_DATE);
		expect(event).toBeDefined();
		expect(event?.label).toBe("Before CSV range");
	});

	it("the after-range anchor note produces a raw event with the expected date and label", () => {
		const event = rangeEvents.find((e) => e.date === AFTER_RANGE_DATE);
		expect(event).toBeDefined();
		expect(event?.label).toBe("After CSV range");
	});

	// ── The scanner is date-agnostic ─────────────────────────────────

	it("scanner returns the before-range event even though its date precedes the CSV", () => {
		// The scanner must not filter by CSV coverage.
		expect(BEFORE_RANGE_DATE < CSV_FIRST_DATE).toBe(true);
		const event = rangeEvents.find((e) => e.date === BEFORE_RANGE_DATE);
		expect(event).toBeDefined();
	});

	it("scanner returns the after-range event even though its date follows the CSV", () => {
		expect(AFTER_RANGE_DATE > CSV_LAST_DATE).toBe(true);
		const event = rangeEvents.find((e) => e.date === AFTER_RANGE_DATE);
		expect(event).toBeDefined();
	});

	// ── The CSV parser produces no DayData for out-of-range dates ────

	it("the CSV produces no DayData for the before-range date", () => {
		// This is the "no bar to attach to" condition.
		expect(csvDateSet.has(BEFORE_RANGE_DATE)).toBe(false);
	});

	it("the CSV produces no DayData for the after-range date", () => {
		expect(csvDateSet.has(AFTER_RANGE_DATE)).toBe(false);
	});

	// ── The mismatch is clean: these events are genuinely out-of-range ─

	it("every DayData date falls within the documented CSV span", () => {
		for (const day of allDays) {
			expect(day.date >= CSV_FIRST_DATE).toBe(true);
			expect(day.date <= CSV_LAST_DATE).toBe(true);
		}
	});

	it("every event with a valid calendar date inside the CSV span has a corresponding DayData", () => {
		// Symmetry check: no event should claim a date that is mysteriously
		// absent from the CSV even though it falls inside the span.  (The test
		// CSV happens to have an entry for every calendar day in its range, so
		// this also serves as a completeness assertion for that data set.)
		//
		// Dates that are syntactically well-formed but semantically invalid
		// (e.g. "2024-13-45" — month 13 does not exist) are excluded from this
		// check; they have no CSV bar regardless of their string position in the
		// range, and that behaviour is already covered by the separate
		// "includes the invalid-date note" test.
		const isValidCalendarDate = (dateStr: string): boolean => {
			const d = new Date(dateStr + "T00:00:00");
			return !isNaN(d.getTime()) && d.toISOString().startsWith(dateStr);
		};

		const eventsInsideRange = rangeEvents.filter(
			(e) =>
				isValidCalendarDate(e.date) &&
				e.date >= CSV_FIRST_DATE &&
				e.date <= CSV_LAST_DATE,
		);
		for (const event of eventsInsideRange) {
			expect(csvDateSet.has(event.date)).toBe(true);
		}
	});
});
