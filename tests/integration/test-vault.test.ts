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
import { parseDaylioCsv, groupByDay } from "../../src/csv-parser";
import type { MoodEntry, DayData } from "../../src/types";
import {
	readVaultEventsFromDisk,
	parseFrontmatter,
	type VaultEventOnDisk,
} from "../helpers/vault-reader";

const VAULT_ROOT = path.resolve(
	__dirname,
	"../../obsidian_daylio_plugin_test_vault"
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
		const md = "---\ndaylio_event: Company founded\n---\nBody.";
		const fm = parseFrontmatter(md);
		expect(fm?.["daylio_event"]).toBe("Company founded");
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

describe("CSV integration (test vault — attachments/daylio_export.csv)", () => {
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
		expect(allEntries).toHaveLength(6246);
	});

	it("has the expected mood distribution", () => {
		const counts = { rad: 0, good: 0, meh: 0, bad: 0, awful: 0 };
		for (const entry of allEntries) counts[entry.mood]++;
		expect(counts.rad).toBe(812);
		expect(counts.good).toBe(1631);
		expect(counts.meh).toBe(2278);
		expect(counts.bad).toBe(1134);
		expect(counts.awful).toBe(391);
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

	it("earliest entry is 1936-01-01", () => {
		const sorted = [...allEntries].sort((a, b) =>
			a.date.localeCompare(b.date)
		);
		expect(sorted[0]?.date).toBe("1936-01-01");
	});

	it("most recent entry is 1954-06-07", () => {
		const sorted = [...allEntries].sort((a, b) =>
			b.date.localeCompare(a.date)
		);
		expect(sorted[0]?.date).toBe("1954-06-07");
	});

	it("groups entries spanning roughly 18 years into the correct day count", () => {
		expect(allDays.length).toBe(5767);
	});

	it("1936-01-01 has one entry with mood meh (known anchor point)", () => {
		const day = allDays.find((d) => d.date === "1936-01-01");
		expect(day).toBeDefined();
		expect(day?.entries).toHaveLength(1);
		expect(day?.entries[0]?.mood).toBe("meh");
	});

	it("1936-01-17 has two entries, both good, sorted by time", () => {
		const day = allDays.find((d) => d.date === "1936-01-17");
		expect(day).toBeDefined();
		expect(day?.entries).toHaveLength(2);
		expect(day?.entries.every((e) => e.mood === "good")).toBe(true);
		const times = day?.entries.map((e) => e.time) ?? [];
		const sorted = [...times].sort();
		expect(times).toEqual(sorted);
	});

	it("1936-02-06 has three entries (rad and good), sorted by time", () => {
		const day = allDays.find((d) => d.date === "1936-02-06");
		expect(day).toBeDefined();
		expect(day?.entries).toHaveLength(3);
		const moods = day?.entries.map((e) => e.mood) ?? [];
		expect(moods).toContain("rad");
		expect(moods).toContain("good");
		const times = day?.entries.map((e) => e.time) ?? [];
		const sorted = [...times].sort();
		expect(times).toEqual(sorted);
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
	let eventsByDate: Map<string, VaultEventOnDisk>;

	beforeAll(() => {
		events = readVaultEventsFromDisk(ENTRIES_DIR);
		eventsByDate = new Map();
		for (const event of events) {
			eventsByDate.set(event.date, event);
		}
	});

	// ── Notes that SHOULD produce events ────────────────────────────

	it("detects the Computable Numbers manuscript event on 1936-05-28", () => {
		expect(eventsByDate.get("1936-05-28")?.label).toBe(
			"Delivered Computable Numbers paper to London Math Society"
		);
	});

	it("detects range event with arrow syntax on 1936-09-20", () => {
		const ev = events.find((e) => e.date === "1936-09-20");
		expect(ev).toBeDefined();
		expect(ev?.label).toBe("Doctoral Studies with Alonzo Church");
		expect(ev?.endDate).toBe("1938-06-15");
		expect(ev?.isRange).toBe(true);
	});

	it("detects range event with 'to' syntax on 1939-11-01", () => {
		const ev = events.find((e) => e.date === "1939-11-01");
		expect(ev).toBeDefined();
		expect(ev?.label).toBe("Head of Hut 8 Naval Enigma");
		expect(ev?.endDate).toBe("1942-10-31");
		expect(ev?.isRange).toBe(true);
	});

	it("detects the first Bombe machine Victory event on 1940-03-18", () => {
		expect(eventsByDate.get("1940-03-18")?.label).toBe(
			"First Bombe machine Victory installed"
		);
	});

	it("detects the hay fever gas mask commute on 1940-06-22", () => {
		expect(eventsByDate.get("1940-06-22")?.label).toBe(
			"Hay fever gas mask commute"
		);
	});

	it("detects the Spider Bombe operational event on 1940-08-08", () => {
		expect(eventsByDate.get("1940-08-08")?.label).toBe(
			"Spider Bombe with diagonal board running"
		);
	});

	it("detects range event defined via pipeline syntax on 1941-03-15", () => {
		const ev = events.find((e) => e.date === "1941-03-15");
		expect(ev).toBeDefined();
		expect(ev?.label).toBe("Engagement to Joan Clarke");
		expect(ev?.endDate).toBe("1941-08-25");
		expect(ev?.isRange).toBe(true);
	});

	it("detects single-day point event overriding filename date via pipe on 1937-06-10", () => {
		const ev = events.find((e) => e.date === "1937-06-10");
		expect(ev).toBeDefined();
		expect(ev?.label).toBe("Visiting Mrs Morcom at Clock House");
	});

	it("detects date override via pipe on 1941-08-25", () => {
		const ev = events.find((e) => e.date === "1941-08-25");
		expect(ev).toBeDefined();
		expect(ev?.label).toBe("Broke engagement with Joan");
	});

	it("detects range event with '..' syntax on 1942-11-12", () => {
		const ev = events.find((e) => e.date === "1942-11-12");
		expect(ev).toBeDefined();
		expect(ev?.label).toBe("Mission to Bell Labs & Washington");
		expect(ev?.endDate).toBe("1943-03-24");
		expect(ev?.isRange).toBe(true);
	});

	it("detects D-Day Normandy decryption vigil on 1944-06-06", () => {
		expect(eventsByDate.get("1944-06-06")?.label).toBe(
			"D-Day Normandy decryption vigil"
		);
	});

	it("detects VE Day range event on 1945-05-08", () => {
		const ev = events.find((e) => e.date === "1945-05-08");
		expect(ev).toBeDefined();
		expect(ev?.label).toBe("VE Day & European Victory Celebrations");
		expect(ev?.endDate).toBe("1945-06-30");
		expect(ev?.isRange).toBe(true);
	});

	it("detects OBE award on 1945-09-04", () => {
		expect(eventsByDate.get("1945-09-04")?.label).toBe(
			"Awarded OBE by King George VI"
		);
	});

	it("detects multi-event items from a single note on 1947-08-23", () => {
		const matching = events.filter((e) => e.filePath.includes("1947-08-23"));
		expect(matching.length).toBeGreaterThanOrEqual(2);
		const labels = matching.map((e) => e.label);
		expect(labels).toContain("Marathon personal best 2h 46m 03s");
		expect(labels).toContain("Fifth place in AAA National Championship");
	});

	it("detects the Mind paper publication on 1950-10-01", () => {
		expect(eventsByDate.get("1950-10-01")?.label).toBe(
			"Published Computing Machinery and Intelligence in Mind"
		);
	});

	it("detects Ferranti Mark 1 installation on 1951-02-15", () => {
		expect(eventsByDate.get("1951-02-15")?.label).toBe(
			"Ferranti Mark 1 delivered to lab"
		);
	});

	it("detects ongoing range event without end date on 1951-03-15", () => {
		const ev = events.find((e) => e.date === "1951-03-15");
		expect(ev).toBeDefined();
		expect(ev?.label).toBe("Fellow of the Royal Society");
		expect(ev?.isRange).toBe(true);
		expect(ev?.endDate).toBeDefined();
	});

	it("preserves label with non-date pipe delimiter on 1951-12-14", () => {
		const ev = events.find((e) => e.date === "1951-12-14");
		expect(ev).toBeDefined();
		expect(ev?.label).toBe("Phyllotaxis | Daisy and sunflower patterns");
	});

	// ── Dated notes without a daylio_event label ────────────────────

	it("includes the note with an empty daylio_event (1944-11-20) but without a label", () => {
		expect(eventsByDate.has("1944-11-20")).toBe(true);
		expect(eventsByDate.get("1944-11-20")?.label).toBeUndefined();
	});

	it("includes dated notes with no daylio_event key but without labels", () => {
		expect(eventsByDate.has("1937-08-14")).toBe(true);
		expect(eventsByDate.get("1937-08-14")?.label).toBeUndefined();
		expect(eventsByDate.has("1940-10-15")).toBe(true);
		expect(eventsByDate.get("1940-10-15")?.label).toBeUndefined();
		expect(eventsByDate.has("1946-07-14")).toBe(true);
		expect(eventsByDate.get("1946-07-14")?.label).toBeUndefined();
	});

	it("detects notes in nested subdirectories", () => {
		const bletchleyEvents = events.filter((e) => e.filePath.includes("bletchley"));
		expect(bletchleyEvents.length).toBeGreaterThan(0);
		const princetonEvents = events.filter((e) => e.filePath.includes("princeton"));
		expect(princetonEvents.length).toBeGreaterThan(0);
		const manchesterEvents = events.filter((e) => e.filePath.includes("manchester"));
		expect(manchesterEvents.length).toBeGreaterThan(0);
		const holidaysEvents = events.filter((e) => e.filePath.includes("holidays"));
		expect(holidaysEvents.length).toBeGreaterThan(0);
	});

	it("excludes notes whose filenames do not begin with a date", () => {
		const allVaultFiles = readVaultEventsFromDisk(VAULT_ROOT);
		const nonDatePaths = allVaultFiles
			.map((e) => e.filePath)
			.filter((fp) => !/^\d{4}-\d{2}-\d{2}/.test(path.basename(fp)));
		expect(nonDatePaths).toHaveLength(0);
	});

	// ── Edge-case behaviour ─────────────────────────────────────────

	it("includes the invalid-date note (1944-13-45) in raw events", () => {
		const rawEvent = events.find((e) => e.date === "1944-13-45");
		expect(rawEvent).toBeDefined();
		expect(rawEvent?.label).toBe("Should be ignored — invalid date");
	});

	it("two notes sharing 1941-03-01 produce two raw events (pre-dedup)", () => {
		const duplicates = events.filter((e) => e.date === "1941-03-01");
		expect(duplicates).toHaveLength(2);
	});

	it("every raw entry has a filePath ending in .md; labelled entries have non-empty labels", () => {
		for (const event of events) {
			expect(event.filePath).toMatch(/\.md$/);
			if (event.label !== undefined) {
				expect(event.label.trim().length).toBeGreaterThan(0);
			}
		}
	});

	it("each event's filePath points to a file that actually exists on disk", () => {
		for (const event of events) {
			expect(fs.existsSync(event.filePath)).toBe(true);
		}
	});
});

// ─── Per-entry marker cluster (Fjord trip, July 1952) ────────────────
//
// Five consecutive notes in entries/holidays exercise the independent-marker
// behaviour. Two carry a daylio_event label; three do not. Each note
// gets its own column marker, independent of whether a label is present.

describe("Fjord trip cluster — independent entry markers", () => {
	let events: VaultEventOnDisk[];
	let byDate: Map<string, VaultEventOnDisk>;

	beforeAll(() => {
		events = readVaultEventsFromDisk(ENTRIES_DIR);
		byDate = new Map(events.map((e) => [e.date, e]));
	});

	// ── Labelled entries (daylio_event set) ─────────────────────────

	it("1952-07-10 is present with label 'Arrival in Bergen with Kjell'", () => {
		expect(byDate.get("1952-07-10")?.label).toBe("Arrival in Bergen with Kjell");
	});

	it("1952-07-12 is present with label 'Bergen Mountain Trekking'", () => {
		expect(byDate.get("1952-07-12")?.label).toBe("Bergen Mountain Trekking");
	});

	// ── Unlabelled entries (no daylio_event) ────────────────────────

	it("1952-07-11 is present without a label", () => {
		expect(byDate.has("1952-07-11")).toBe(true);
		expect(byDate.get("1952-07-11")?.label).toBeUndefined();
	});

	it("1952-07-13 is present without a label", () => {
		expect(byDate.has("1952-07-13")).toBe(true);
		expect(byDate.get("1952-07-13")?.label).toBeUndefined();
	});

	it("1952-07-14 is present without a label", () => {
		expect(byDate.has("1952-07-14")).toBe(true);
		expect(byDate.get("1952-07-14")?.label).toBeUndefined();
	});

	// ── All five are within the CSV date range ───────────────────────

	it("all five cluster dates fall within the CSV data range", () => {
		const clusterDates = [
			"1952-07-10", "1952-07-11", "1952-07-12",
			"1952-07-13", "1952-07-14",
		];
		const csvText = fs.readFileSync(CSV_PATH, "utf8");
		const csvDateSet = new Set(
			groupByDay(parseDaylioCsv(csvText)).map((d) => d.date)
		);
		for (const date of clusterDates) {
			expect(csvDateSet.has(date)).toBe(true);
		}
	});

	// ── Structural invariant ─────────────────────────────────────────

	it("all five cluster entries appear in the raw scan output", () => {
		const clusterDates = new Set([
			"1952-07-10", "1952-07-11", "1952-07-12",
			"1952-07-13", "1952-07-14",
		]);
		const found = events.filter((e) => clusterDates.has(e.date));
		expect(found).toHaveLength(5);
	});
});

// ─── Date range mismatch ──────────────────────────────────────────────

describe("Date range mismatch — events outside the CSV date span", () => {
	const BEFORE_RANGE_DATE = "1935-12-25";
	const AFTER_RANGE_DATE = "1955-12-31";
	const CSV_FIRST_DATE = "1936-01-01";
	const CSV_LAST_DATE = "1954-06-07";

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
});
