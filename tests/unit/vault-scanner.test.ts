import { describe, it, expect, vi } from "vitest";
import { App, TFile } from "obsidian";
import { scanVaultEvents, parseEventString } from "../../src/main";

// ─── Mock App factory ────────────────────────────────────────────────

/**
 * Builds a minimal Obsidian App stand-in whose vault and metadataCache
 * behave just enough to exercise scanVaultEvents().
 */
interface MockFileSpec {
	/** The filename WITHOUT the .md extension (e.g. "2024-01-15 My note") */
	basename: string;
	/** Vault-relative path (e.g. "2024-01-15 My note.md") */
	path: string;
	/** frontmatter key→value map, or null to simulate no frontmatter */
	frontmatter: Record<string, unknown> | null;
}

function buildMockApp(specs: MockFileSpec[]): App {
	// Build file objects that look like TFile instances to the scanner
	const files = specs.map((s) =>
		Object.assign(Object.create(TFile.prototype), {
			basename: s.basename,
			path: s.path,
		})
	);

	return {
		vault: {
			getMarkdownFiles: () => files,
		},
		metadataCache: {
			getFileCache: (file: TFile) => {
				const spec = specs.find((s) => s.path === file.path);
				if (!spec?.frontmatter) return null;
				return { frontmatter: spec.frontmatter };
			},
		},
	} as unknown as App;
}

// ─── Tests ──────────────────────────────────────────────────────────

describe("scanVaultEvents", () => {
	it("returns an empty array when the vault has no files", () => {
		const app = buildMockApp([]);
		expect(scanVaultEvents(app)).toEqual([]);
	});

	it("returns an event for a valid dated note with daylio_event", () => {
		const app = buildMockApp([
			{
				basename: "2024-03-15 Started therapy",
				path: "2024-03-15 Started therapy.md",
				frontmatter: { daylio_event: "Started therapy" },
			},
		]);
		const events = scanVaultEvents(app);
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			date: "2024-03-15",
			label: "Started therapy",
			filePath: "2024-03-15 Started therapy.md",
		});
	});

	it("trims whitespace from the event label", () => {
		const app = buildMockApp([
			{
				basename: "2024-05-01 Some event",
				path: "2024-05-01 Some event.md",
				frontmatter: { daylio_event: "  Trimmed label  " },
			},
		]);
		const [event] = scanVaultEvents(app);
		expect(event?.label).toBe("Trimmed label");
	});

	it("skips a note whose filename does not begin with YYYY-MM-DD", () => {
		const app = buildMockApp([
			{
				basename: "Meeting notes",
				path: "Meeting notes.md",
				frontmatter: { daylio_event: "Should be ignored" },
			},
		]);
		expect(scanVaultEvents(app)).toHaveLength(0);
	});

	it("includes a dated note with empty daylio_event as an unlabelled entry", () => {
		const app = buildMockApp([
			{
				basename: "2024-07-04 Empty event",
				path: "2024-07-04 Empty event.md",
				frontmatter: { daylio_event: "" },
			},
		]);
		const events = scanVaultEvents(app);
		expect(events).toHaveLength(1);
		expect(events[0]?.label).toBeUndefined();
		expect(events[0]?.date).toBe("2024-07-04");
	});

	it("includes a dated note with whitespace-only daylio_event as unlabelled", () => {
		const app = buildMockApp([
			{
				basename: "2024-07-05 Whitespace event",
				path: "2024-07-05 Whitespace event.md",
				frontmatter: { daylio_event: "   " },
			},
		]);
		const events = scanVaultEvents(app);
		expect(events).toHaveLength(1);
		expect(events[0]?.label).toBeUndefined();
	});

	it("includes a dated note with no frontmatter as an unlabelled entry", () => {
		const app = buildMockApp([
			{
				basename: "2024-08-01 Plain note",
				path: "2024-08-01 Plain note.md",
				frontmatter: null,
			},
		]);
		const events = scanVaultEvents(app);
		expect(events).toHaveLength(1);
		expect(events[0]?.label).toBeUndefined();
	});

	it("includes a dated note without a daylio_event key as unlabelled", () => {
		const app = buildMockApp([
			{
				basename: "2024-09-10 Tagged note",
				path: "2024-09-10 Tagged note.md",
				frontmatter: { tags: ["journal"], title: "Something else" },
			},
		]);
		const events = scanVaultEvents(app);
		expect(events).toHaveLength(1);
		expect(events[0]?.label).toBeUndefined();
	});

	it("includes a dated note where daylio_event is a non-string (e.g. number) as unlabelled", () => {
		const app = buildMockApp([
			{
				basename: "2024-10-01 Numeric event",
				path: "2024-10-01 Numeric event.md",
				frontmatter: { daylio_event: 42 },
			},
		]);
		const events = scanVaultEvents(app);
		expect(events).toHaveLength(1);
		expect(events[0]?.label).toBeUndefined();
	});

	it("includes a dated note where daylio_event is null as unlabelled", () => {
		const app = buildMockApp([
			{
				basename: "2024-10-02 Null event",
				path: "2024-10-02 Null event.md",
				frontmatter: { daylio_event: null },
			},
		]);
		const events = scanVaultEvents(app);
		expect(events).toHaveLength(1);
		expect(events[0]?.label).toBeUndefined();
	});

	it("includes a dated note even when the metadata cache is null", () => {
		// Cache is null when frontmatter is null in buildMockApp.
		// The date comes from the filename so the entry is still returned.
		const app = buildMockApp([
			{
				basename: "2024-11-01 No cache",
				path: "2024-11-01 No cache.md",
				frontmatter: null,
			},
		]);
		const events = scanVaultEvents(app);
		expect(events).toHaveLength(1);
		expect(events[0]?.label).toBeUndefined();
		expect(events[0]?.filePath).toBe("2024-11-01 No cache.md");
	});

	it("returns one event per valid dated note", () => {
		const app = buildMockApp([
			{
				basename: "2019-04-15 New job",
				path: "2019-04-15 New job.md",
				frontmatter: { daylio_event: "New job" },
			},
			{
				basename: "2022-06-01 Wedding",
				path: "2022-06-01 Wedding.md",
				frontmatter: { daylio_event: "Wedding" },
			},
			{
				basename: "Undated note",
				path: "Undated note.md",
				frontmatter: { daylio_event: "Should be ignored" },
			},
		]);
		const events = scanVaultEvents(app);
		expect(events).toHaveLength(2);
		expect(events.map((e) => e.date)).toEqual(
			expect.arrayContaining(["2019-04-15", "2022-06-01"])
		);
	});

	it("includes both entries when two notes share the same date prefix", () => {
		// The caller (renderGraph) deduplicates via a Map; the scanner
		// itself returns both to let the caller decide which wins.
		const app = buildMockApp([
			{
				basename: "2021-03-01 Shift Report A",
				path: "2021-03-01 Shift Report A.md",
				frontmatter: { daylio_event: "Shift handover A" },
			},
			{
				basename: "2021-03-01 Shift Report B",
				path: "2021-03-01 Shift Report B.md",
				frontmatter: { daylio_event: "Shift handover B" },
			},
		]);
		const events = scanVaultEvents(app);
		expect(events).toHaveLength(2);
		expect(events.every((e) => e.date === "2021-03-01")).toBe(true);
	});

	it("the date extracted is only the YYYY-MM-DD prefix, ignoring the rest of the basename", () => {
		const app = buildMockApp([
			{
				basename: "2025-12-31 New Year's Eve party plan",
				path: "2025-12-31 New Year's Eve party plan.md",
				frontmatter: { daylio_event: "Party" },
			},
		]);
		const [event] = scanVaultEvents(app);
		expect(event?.date).toBe("2025-12-31");
	});
});

describe("scanVaultEvents — scanDir filtering", () => {
	const specs = [
		{
			basename: "2024-01-01 Root note",
			path: "2024-01-01 Root note.md",
			frontmatter: { daylio_event: "Root event" },
		},
		{
			basename: "2024-02-01 Entries note",
			path: "entries/2024-02-01 Entries note.md",
			frontmatter: { daylio_event: "Entries event" },
		},
		{
			basename: "2024-03-01 Nested note",
			path: "entries/sub/2024-03-01 Nested note.md",
			frontmatter: { daylio_event: "Nested event" },
		},
		{
			basename: "2024-04-01 Other dir",
			path: "journal/2024-04-01 Other dir.md",
			frontmatter: { daylio_event: "Journal event" },
		},
	];

	it("returns all files when scanDir is undefined", () => {
		const app = buildMockApp(specs);
		expect(scanVaultEvents(app, undefined)).toHaveLength(4);
	});

	it("returns all files when scanDir is an empty string", () => {
		const app = buildMockApp(specs);
		expect(scanVaultEvents(app, "")).toHaveLength(4);
	});

	it("returns only files inside the specified directory", () => {
		const app = buildMockApp(specs);
		const events = scanVaultEvents(app, "entries");
		expect(events).toHaveLength(2);
		expect(events.map((e) => e.label)).toEqual(
			expect.arrayContaining(["Entries event", "Nested event"])
		);
	});

	it("excludes files in the root when a scanDir is set", () => {
		const app = buildMockApp(specs);
		const events = scanVaultEvents(app, "entries");
		expect(events.some((e) => e.label === "Root event")).toBe(false);
	});

	it("excludes files in other directories when a scanDir is set", () => {
		const app = buildMockApp(specs);
		const events = scanVaultEvents(app, "entries");
		expect(events.some((e) => e.label === "Journal event")).toBe(false);
	});

	it("includes files nested deeper than one level under scanDir", () => {
		const app = buildMockApp(specs);
		const events = scanVaultEvents(app, "entries");
		expect(events.some((e) => e.label === "Nested event")).toBe(true);
	});

	it("does not accidentally match a directory that is a prefix of scanDir", () => {
		// "entries2" should not match when scanDir is "entries"
		const app = buildMockApp([
			{
				basename: "2024-05-01 Tricky",
				path: "entries2/2024-05-01 Tricky.md",
				frontmatter: { daylio_event: "Tricky event" },
			},
		]);
		expect(scanVaultEvents(app, "entries")).toHaveLength(0);
	});

	it("handles a trailing slash in scanDir gracefully", () => {
		const app = buildMockApp(specs);
		const events = scanVaultEvents(app, "entries/");
		expect(events).toHaveLength(2);
	});

	it("parses daylio_events list properties with pipeline range syntax", () => {
		const app = buildMockApp([
			{
				basename: "2024-08-12 Vacation",
				path: "2024-08-12 Vacation.md",
				frontmatter: {
					daylio_events: [
						"Got a cat",
						"Summer Trip | 2024-08-12 -> 2024-08-28",
					],
				},
			},
		]);
		const events = scanVaultEvents(app);
		expect(events).toHaveLength(2);
		expect(events[0]).toEqual({
			date: "2024-08-12",
			endDate: undefined,
			isRange: undefined,
			label: "Got a cat",
			filePath: "2024-08-12 Vacation.md",
		});
		expect(events[1]).toEqual({
			date: "2024-08-12",
			endDate: "2024-08-28",
			isRange: true,
			label: "Summer Trip",
			filePath: "2024-08-12 Vacation.md",
		});
	});

	it("treats unspecified end date 'event | YYYY-MM-DD -> ' as an ongoing event continuing until present day", () => {
		const app = buildMockApp([
			{
				basename: "2024-01-15 Project",
				path: "2024-01-15 Project.md",
				frontmatter: {
					daylio_event: "Ongoing Fitness Plan | 2024-01-01 -> ",
				},
			},
		]);
		const events = scanVaultEvents(app);
		expect(events).toHaveLength(1);
		expect(events[0]?.label).toBe("Ongoing Fitness Plan");
		expect(events[0]?.date).toBe("2024-01-01");
		expect(events[0]?.isRange).toBe(true);
		expect(events[0]?.endDate).toBeDefined();
		// endDate should be today's ISO date
		const now = new Date();
		const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
		expect(events[0]?.endDate).toBe(todayStr);
	});

	it("treats 'event | YYYY-MM-DD' as a single-day point event overriding the filename date", () => {
		const app = buildMockApp([
			{
				basename: "2024-01-01 Journal",
				path: "2024-01-01 Journal.md",
				frontmatter: {
					daylio_event: "Got a cat | 2024-05-14",
				},
			},
		]);
		const events = scanVaultEvents(app);
		expect(events).toHaveLength(1);
		expect(events[0]?.label).toBe("Got a cat");
		// Overrides filename date 2024-01-01 to 2024-05-14
		expect(events[0]?.date).toBe("2024-05-14");
		expect(events[0]?.endDate).toBeUndefined();
		expect(events[0]?.isRange).toBeFalsy();
	});

	it("logs a warning and treats range event as point event when end date is earlier than start date", () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		const app = buildMockApp([
			{
				basename: "2024-08-01 Reversed Dates",
				path: "2024-08-01 Reversed Dates.md",
				frontmatter: {
					daylio_event: "Bad Range | 2024-08-20 -> 2024-08-10",
				},
			},
		]);

		const events = scanVaultEvents(app);
		expect(events).toHaveLength(1);
		expect(events[0]).toEqual({
			date: "2024-08-20",
			endDate: undefined,
			isRange: undefined,
			label: "Bad Range",
			filePath: "2024-08-01 Reversed Dates.md",
		});

		expect(warnSpy).toHaveBeenCalledWith(
			"[daylio]",
			expect.stringContaining("has end date (2024-08-10) earlier than start date (2024-08-20)")
		);

		warnSpy.mockRestore();
	});

	it("logs a warning and treats ongoing range starting in the future as a point event", () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		const parsed = parseEventString("Future Project | 2099-01-01 -> ", "2024-01-01");
		expect(parsed).toEqual({
			label: "Future Project",
			startDate: "2099-01-01",
		});

		expect(warnSpy).toHaveBeenCalledWith(
			"[daylio]",
			expect.stringContaining("in the future")
		);

		warnSpy.mockRestore();
	});
});
