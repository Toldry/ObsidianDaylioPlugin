import { describe, it, expect } from "vitest";
import { App, TFile } from "obsidian";
import { scanVaultEvents } from "../../src/main";

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

	it("skips a note with an empty daylio_event string", () => {
		const app = buildMockApp([
			{
				basename: "2024-07-04 Empty event",
				path: "2024-07-04 Empty event.md",
				frontmatter: { daylio_event: "" },
			},
		]);
		expect(scanVaultEvents(app)).toHaveLength(0);
	});

	it("skips a note with a whitespace-only daylio_event string", () => {
		const app = buildMockApp([
			{
				basename: "2024-07-05 Whitespace event",
				path: "2024-07-05 Whitespace event.md",
				frontmatter: { daylio_event: "   " },
			},
		]);
		expect(scanVaultEvents(app)).toHaveLength(0);
	});

	it("skips a note with no frontmatter at all", () => {
		const app = buildMockApp([
			{
				basename: "2024-08-01 Plain note",
				path: "2024-08-01 Plain note.md",
				frontmatter: null,
			},
		]);
		expect(scanVaultEvents(app)).toHaveLength(0);
	});

	it("skips a note whose frontmatter lacks a daylio_event key", () => {
		const app = buildMockApp([
			{
				basename: "2024-09-10 Tagged note",
				path: "2024-09-10 Tagged note.md",
				frontmatter: { tags: ["journal"], title: "Something else" },
			},
		]);
		expect(scanVaultEvents(app)).toHaveLength(0);
	});

	it("skips a note where daylio_event is a non-string (e.g. a number)", () => {
		const app = buildMockApp([
			{
				basename: "2024-10-01 Numeric event",
				path: "2024-10-01 Numeric event.md",
				frontmatter: { daylio_event: 42 },
			},
		]);
		expect(scanVaultEvents(app)).toHaveLength(0);
	});

	it("skips a note where daylio_event is null", () => {
		const app = buildMockApp([
			{
				basename: "2024-10-02 Null event",
				path: "2024-10-02 Null event.md",
				frontmatter: { daylio_event: null },
			},
		]);
		expect(scanVaultEvents(app)).toHaveLength(0);
	});

	it("skips a note where the cache itself is null", () => {
		// buildMockApp returns null cache when frontmatter is null
		const app = buildMockApp([
			{
				basename: "2024-11-01 No cache",
				path: "2024-11-01 No cache.md",
				frontmatter: null,
			},
		]);
		expect(scanVaultEvents(app)).toHaveLength(0);
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
				basename: "2021-03-01 Anthropic Founded",
				path: "2021-03-01 Anthropic Founded.md",
				frontmatter: { daylio_event: "Anthropic founded" },
			},
			{
				basename: "2021-03-01 Antrohpic Founded",
				path: "2021-03-01 Antrohpic Founded.md",
				frontmatter: { daylio_event: "Anthropic founded" },
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
});
