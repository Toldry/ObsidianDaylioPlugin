import { describe, it, expect } from "vitest";
import {
	computeEntrySpans,
	packEventsIntoTracks,
	packRangeEventsIntoTracks,
	computeRangeMoodProportions,
	computeStickyLabelPosition,
	type EntrySpan,
} from "../../src/main";
import type { DayData, VaultEvent } from "../../src/main";

// ─── Helpers ────────────────────────────────────────────────────────

function days(...dates: string[]): DayData[] {
	return dates.map((date) => ({ date, entries: [] }));
}

function entry(
	date: string,
	filePath = `${date}.md`,
	label?: string,
): VaultEvent {
	return { date, filePath, label };
}

function spanDates(span: EntrySpan, allDays: DayData[]): string[] {
	return allDays
		.slice(span.startIdx, span.endIdx + 1)
		.map((d) => d.date);
}

// ─── Tests ──────────────────────────────────────────────────────────

describe("computeEntrySpans", () => {
	it("returns an empty array when there are no vault entries", () => {
		const result = computeEntrySpans(days("2024-01-01", "2024-01-02"), []);
		expect(result).toHaveLength(0);
	});

	it("returns an empty array when the days list is empty", () => {
		const result = computeEntrySpans([], [entry("2024-01-01")]);
		expect(result).toHaveLength(0);
	});

	it("an entry before the first data day spans from day 0 to the end", () => {
		const d = days("2024-03-01", "2024-03-02", "2024-03-03");
		const result = computeEntrySpans(d, [entry("2020-01-01")]);
		expect(result).toHaveLength(1);
		expect(result[0]?.startIdx).toBe(0);
		expect(result[0]?.endIdx).toBe(2);
	});

	it("a single entry at the first data day spans to the end", () => {
		const d = days("2024-01-01", "2024-01-02", "2024-01-03");
		const result = computeEntrySpans(d, [entry("2024-01-01")]);
		expect(result).toHaveLength(1);
		expect(spanDates(result[0]!, d)).toEqual([
			"2024-01-01", "2024-01-02", "2024-01-03",
		]);
	});

	it("two entries partition the days correctly", () => {
		const d = days(
			"2024-01-01", "2024-01-02", "2024-01-03",
			"2024-01-04", "2024-01-05",
		);
		const entries = [entry("2024-01-01"), entry("2024-01-04")];
		const result = computeEntrySpans(d, entries);
		expect(result).toHaveLength(2);
		expect(spanDates(result[0]!, d)).toEqual([
			"2024-01-01", "2024-01-02", "2024-01-03",
		]);
		expect(spanDates(result[1]!, d)).toEqual([
			"2024-01-04", "2024-01-05",
		]);
	});

	it("days before the first entry are not covered by any span", () => {
		const d = days("2024-01-01", "2024-01-02", "2024-01-03");
		const result = computeEntrySpans(d, [entry("2024-01-02")]);
		expect(result).toHaveLength(1);
		expect(result[0]?.startIdx).toBe(1); // 2024-01-01 is uncovered
	});

	it("entry order in the input does not affect the result", () => {
		const d = days("2024-01-01", "2024-01-02", "2024-01-03");
		const shuffled = [entry("2024-01-03"), entry("2024-01-01")];
		const sorted  = [entry("2024-01-01"), entry("2024-01-03")];
		expect(computeEntrySpans(d, shuffled)).toEqual(
			computeEntrySpans(d, sorted),
		);
	});

	it("non-consecutive data days are handled correctly", () => {
		// Sparse CSV — only some calendar days have mood entries.
		const d = days("2024-01-01", "2024-01-05", "2024-01-10");
		const entries = [entry("2024-01-01"), entry("2024-01-05")];
		const result = computeEntrySpans(d, entries);
		expect(result).toHaveLength(2);
		expect(spanDates(result[0]!, d)).toEqual(["2024-01-01"]);
		expect(spanDates(result[1]!, d)).toEqual([
			"2024-01-05", "2024-01-10",
		]);
	});

	// ── Edinburgh trip cluster ───────────────────────────────────────
	// Five consecutive notes: labelled on day 1 and day 5, unlabelled
	// on days 2–4.  This is the scenario that motivated the feature:
	// the wide span must be owned by the labelled day-1 entry and cover
	// days 2–4 as well, not produce five separate single-day spans.

	it("Edinburgh cluster: unlabelled notes extend the labelled entry's span", () => {
		const d = days(
			"2024-03-18", "2024-03-19", "2024-03-20",
			"2024-03-21", "2024-03-22",
		);
		const entries = [
			entry("2024-03-18", "2024-03-18.md", "Edinburgh trip"),
			entry("2024-03-19", "2024-03-19.md"),   // unlabelled
			entry("2024-03-20", "2024-03-20.md"),   // unlabelled
			entry("2024-03-21", "2024-03-21.md"),   // unlabelled
			entry("2024-03-22", "2024-03-22.md", "Back from Edinburgh"),
		];
		const result = computeEntrySpans(d, entries);

		// Five entries → five spans (each day starts a new entry)
		expect(result).toHaveLength(5);

		// Span 0: 2024-03-18 only (next entry starts 2024-03-19)
		expect(spanDates(result[0]!, d)).toEqual(["2024-03-18"]);
		expect(result[0]?.entry.label).toBe("Edinburgh trip");

		// Spans 1–3: the three unlabelled days, each a single-day span
		expect(spanDates(result[1]!, d)).toEqual(["2024-03-19"]);
		expect(result[1]?.entry.label).toBeUndefined();
		expect(spanDates(result[2]!, d)).toEqual(["2024-03-20"]);
		expect(result[2]?.entry.label).toBeUndefined();
		expect(spanDates(result[3]!, d)).toEqual(["2024-03-21"]);
		expect(result[3]?.entry.label).toBeUndefined();

		// Span 4: 2024-03-22 (last entry, no successor → spans to end)
		expect(spanDates(result[4]!, d)).toEqual(["2024-03-22"]);
		expect(result[4]?.entry.label).toBe("Back from Edinburgh");
	});

	it("Edinburgh cluster WITHOUT unlabelled notes: labelled entry spans the gap", () => {
		// If only the two labelled bookend notes exist, the first one's
		// span must cover 2024-03-18 through 2024-03-21 (the four days
		// before the second entry starts on 2024-03-22).
		const d = days(
			"2024-03-18", "2024-03-19", "2024-03-20",
			"2024-03-21", "2024-03-22",
		);
		const entries = [
			entry("2024-03-18", "2024-03-18.md", "Edinburgh trip"),
			entry("2024-03-22", "2024-03-22.md", "Back from Edinburgh"),
		];
		const result = computeEntrySpans(d, entries);

		expect(result).toHaveLength(2);
		expect(spanDates(result[0]!, d)).toEqual([
			"2024-03-18", "2024-03-19", "2024-03-20", "2024-03-21",
		]);
		expect(spanDates(result[1]!, d)).toEqual(["2024-03-22"]);
	});
});

describe("packEventsIntoTracks", () => {
	it("packs non-overlapping range events into track 0", () => {
		const d = days("2024-08-01", "2024-08-02", "2024-08-03", "2024-08-04", "2024-08-05");
		const events: VaultEvent[] = [
			{ date: "2024-08-01", endDate: "2024-08-02", isRange: true, label: "Trip 1", filePath: "1.md" },
			{ date: "2024-08-03", endDate: "2024-08-05", isRange: true, label: "Trip 2", filePath: "2.md" },
		];
		const { spans, trackCount } = packEventsIntoTracks(events, d, 100, 20);
		expect(trackCount).toBe(1);
		expect(spans).toHaveLength(2);
		expect(spans[0]?.trackIdx).toBe(0);
		expect(spans[1]?.trackIdx).toBe(0);
	});

	it("packs overlapping range events into separate tracks", () => {
		const d = days("2024-08-01", "2024-08-02", "2024-08-03", "2024-08-04", "2024-08-05");
		const events: VaultEvent[] = [
			{ date: "2024-08-01", endDate: "2024-08-04", isRange: true, label: "Big Trip", filePath: "1.md" },
			{ date: "2024-08-02", endDate: "2024-08-03", isRange: true, label: "Nested Offsite", filePath: "2.md" },
		];
		const { spans, trackCount } = packEventsIntoTracks(events, d, 100, 20);
		expect(trackCount).toBe(2);
		expect(spans).toHaveLength(2);
		expect(spans[0]?.trackIdx).toBe(0);
		expect(spans[1]?.trackIdx).toBe(1);
	});

	it("unifies 1-day point events and multi-day range events placing range events above point events locally", () => {
		const d = days("2024-08-01", "2024-08-02", "2024-08-03", "2024-08-04");
		// Point 1 is at Day 2 (2024-08-02), which is inside Range 1 (Days 2-4: 2024-08-02 -> 2024-08-04)
		const events: VaultEvent[] = [
			{ date: "2024-08-02", label: "Point 1 (inside range)", filePath: "1.md" },
			{ date: "2024-08-02", endDate: "2024-08-04", isRange: true, label: "Range 1", filePath: "2.md" },
		];
		const { spans, trackCount } = packEventsIntoTracks(events, d, 200, 20);
		expect(spans).toHaveLength(2);
		const rangeSpan = spans.find((s) => s.event.label === "Range 1");
		const pointSpan = spans.find((s) => s.event.label === "Point 1 (inside range)");
		expect(rangeSpan?.isRange).toBe(true);
		expect(pointSpan?.isRange).toBe(false);
		// Range event is placed on track 0, overlapping point event is placed on track 1 (below range event)
		expect(rangeSpan?.trackIdx).toBe(0);
		expect(pointSpan?.trackIdx).toBe(1);
		expect(trackCount).toBe(2);
	});

	it("packs point events into the highest available tracks locally without global gaps", () => {
		const d = days(
			"2024-08-01", "2024-08-02", "2024-08-03", "2024-08-04",
			"2024-08-05", "2024-08-06", "2024-08-07", "2024-08-08",
		);
		const events: VaultEvent[] = [
			{ date: "2024-08-01", label: "Point A", filePath: "p1.md" },
			{ date: "2024-08-02", endDate: "2024-08-05", isRange: true, label: "Range 1", filePath: "r1.md" },
			{ date: "2024-08-03", endDate: "2024-08-06", isRange: true, label: "Range 2", filePath: "r2.md" },
			{ date: "2024-08-02", label: "Point B", filePath: "p2.md" },
		];
		const { spans, trackCount } = packEventsIntoTracks(events, d, 150, 20);
		const r1 = spans.find((s) => s.event.label === "Range 1");
		const r2 = spans.find((s) => s.event.label === "Range 2");
		const p1 = spans.find((s) => s.event.label === "Point A");
		const p2 = spans.find((s) => s.event.label === "Point B");

		// Ranges take tracks 0 and 1
		expect(r1?.trackIdx).toBe(0); // starts on day 2 -> track 0
		expect(r2?.trackIdx).toBe(1); // overlaps with r1 -> track 1

		// Point A (Day 1) is free on track 0 (no range on Day 1)
		expect(p1?.trackIdx).toBe(0);

		// Point B (Day 2) overlaps Range 1 (track 0), but Track 1 is free on Day 2 before Range 2 (starts Day 3)
		expect(p2?.trackIdx).toBe(1);
		expect(trackCount).toBe(2);
	});

	it("orders events chronologically so earlier start dates receive higher tracks (lower trackIdx)", () => {
		const d = days("2024-08-01", "2024-08-02", "2024-08-03", "2024-08-04", "2024-08-05");
		const events: VaultEvent[] = [
			{ date: "2024-08-03", endDate: "2024-08-05", isRange: true, label: "Later Range", filePath: "2.md" },
			{ date: "2024-08-01", endDate: "2024-08-04", isRange: true, label: "Earlier Range", filePath: "1.md" },
		];
		const { spans } = packEventsIntoTracks(events, d, 100, 20);
		const earlier = spans.find((s) => s.event.label === "Earlier Range");
		const later = spans.find((s) => s.event.label === "Later Range");
		expect(earlier?.trackIdx).toBe(0);
		expect(later?.trackIdx).toBe(1);
	});

	it("avoids collision when 1-day event label text is wider than its 1-day bar width", () => {
		const d = days("2024-08-01", "2024-08-02", "2024-08-03");
		// stride = 20, barWidth = 8.
		// Event 1 at index 0 (startX = 40). text width = 150px (extends to x ~ 190).
		// Event 2 at index 1 (startX = 60). Since 60 < 190, it drops to track 1!
		const events: VaultEvent[] = [
			{ date: "2024-08-01", label: "Very Long Point Event Label That Overflows", filePath: "1.md" },
			{ date: "2024-08-02", label: "Next Day Milestone", filePath: "2.md" },
		];
		const { spans, trackCount } = packEventsIntoTracks(events, d, 20, 8, (t) => t.length * 6);
		expect(trackCount).toBe(2);
		expect(spans[0]?.trackIdx).toBe(0);
		expect(spans[1]?.trackIdx).toBe(1);
	});

	it("marks narrow range events as isCallout = true and wide range events as isCallout = false", () => {
		const d = days(
			"2024-08-01", "2024-08-02", "2024-08-03", "2024-08-04",
			"2024-08-05", "2024-08-06", "2024-08-07", "2024-08-08",
		);
		// Short event: span 1 day (width 20px < text 80px) -> isCallout = true
		// Wide event: span 7 days (width 140px > text 50px) -> isCallout = false
		const events: VaultEvent[] = [
			{ date: "2024-08-01", endDate: "2024-08-02", isRange: true, label: "Short Narrow Event", filePath: "1.md" },
			{ date: "2024-08-01", endDate: "2024-08-08", isRange: true, label: "Wide Event", filePath: "2.md" },
		];
		const { spans } = packEventsIntoTracks(events, d, 20, 8, (t) => t.length * 5);
		const shortSpan = spans.find((s) => s.event.label === "Short Narrow Event");
		const wideSpan = spans.find((s) => s.event.label === "Wide Event");
		expect(shortSpan?.isCallout).toBe(true);
		expect(wideSpan?.isCallout).toBe(false);
	});
});

describe("computeRangeMoodProportions", () => {
	it("computes accurate counts and percentages for a range of days", () => {
		const d: DayData[] = [
			{ date: "2024-08-01", entries: [{ date: "2024-08-01", time: "10:00", mood: "rad" }] },
			{ date: "2024-08-02", entries: [{ date: "2024-08-02", time: "11:00", mood: "rad" }] },
			{ date: "2024-08-03", entries: [{ date: "2024-08-03", time: "12:00", mood: "good" }] },
			{ date: "2024-08-04", entries: [{ date: "2024-08-04", time: "13:00", mood: "meh" }] },
		];
		// 4 entries: 2 rad (50%), 1 good (25%), 1 meh (25%), 0 bad, 0 awful
		const summary = computeRangeMoodProportions(d, 0, 3);
		expect(summary.totalEntries).toBe(4);
		expect(summary.totalDays).toBe(4);

		const rad = summary.proportions.find((p) => p.mood === "rad");
		const good = summary.proportions.find((p) => p.mood === "good");
		const meh = summary.proportions.find((p) => p.mood === "meh");
		const bad = summary.proportions.find((p) => p.mood === "bad");
		const awful = summary.proportions.find((p) => p.mood === "awful");

		expect(rad?.count).toBe(2);
		expect(rad?.percentage).toBeCloseTo(50);

		expect(good?.count).toBe(1);
		expect(good?.percentage).toBeCloseTo(25);

		expect(meh?.count).toBe(1);
		expect(meh?.percentage).toBeCloseTo(25);

		expect(bad?.count).toBe(0);
		expect(bad?.percentage).toBe(0);

		expect(awful?.count).toBe(0);
		expect(awful?.percentage).toBe(0);
	});

	it("handles days with no entries gracefully", () => {
		const d: DayData[] = [
			{ date: "2024-08-01", entries: [] },
			{ date: "2024-08-02", entries: [] },
		];
		const summary = computeRangeMoodProportions(d, 0, 1);
		expect(summary.totalEntries).toBe(0);
		expect(summary.totalDays).toBe(2);
		for (const p of summary.proportions) {
			expect(p.count).toBe(0);
			expect(p.percentage).toBe(0);
		}
	});

	it("handles days with multiple entries per day", () => {
		const d: DayData[] = [
			{
				date: "2024-08-01",
				entries: [
					{ date: "2024-08-01", time: "09:00", mood: "rad" },
					{ date: "2024-08-01", time: "18:00", mood: "good" },
				],
			},
		];
		const summary = computeRangeMoodProportions(d, 0, 0);
		expect(summary.totalEntries).toBe(2);
		expect(summary.totalDays).toBe(1);

		const rad = summary.proportions.find((p) => p.mood === "rad");
		const good = summary.proportions.find((p) => p.mood === "good");
		expect(rad?.count).toBe(1);
		expect(rad?.percentage).toBe(50);
		expect(good?.count).toBe(1);
		expect(good?.percentage).toBe(50);
	});
});

describe("computeStickyLabelPosition", () => {
	it("returns original non-sticky position when beginning of event is visible in frame", () => {
		const result = computeStickyLabelPosition({
			x1: 100,
			x2: 1000,
			cardX: 100,
			cardW: 80,
			pillW: 900,
			isCallout: false,
			visibleLeft: 0,
		});
		expect(result.isSticky).toBe(false);
		expect(result.x).toBe(100);
		expect(result.width).toBe(900);
	});

	it("pins wide range event label to left edge when start is scrolled off to the left", () => {
		// Event spans 100..1000. Viewport starts at 400.
		// Start (100) is out of frame. Label should stick to visibleLeft + 8 = 408.
		const result = computeStickyLabelPosition({
			x1: 100,
			x2: 1000,
			cardX: 100,
			cardW: 80,
			pillW: 900,
			isCallout: false,
			visibleLeft: 400,
		});
		expect(result.isSticky).toBe(true);
		expect(result.x).toBe(408);
		expect(result.width).toBe(1000 - 408); // remaining visible pill width
	});

	it("clamps sticky position near the right end so it does not overflow past x2", () => {
		// Event spans 100..1000. Viewport starts at 980.
		const result = computeStickyLabelPosition({
			x1: 100,
			x2: 1000,
			cardX: 100,
			cardW: 80,
			pillW: 900,
			isCallout: false,
			visibleLeft: 980,
		});
		expect(result.isSticky).toBe(true);
		expect(result.x).toBe(960); // 1000 - 40
		expect(result.width).toBe(40);
	});

	it("pins callout range event card when start is out of frame", () => {
		// Unclamped sticky position
		const result1 = computeStickyLabelPosition({
			x1: 100,
			x2: 300,
			cardX: 120,
			cardW: 160,
			pillW: 200,
			isCallout: true,
			visibleLeft: 120,
		});
		expect(result1.isSticky).toBe(true);
		expect(result1.x).toBe(128); // visibleLeft + 8 = 128 (128 + 160 = 288 <= 300)
		expect(result1.width).toBe(160); // callout card preserves full width

		// Clamped sticky position near the right edge
		const result2 = computeStickyLabelPosition({
			x1: 100,
			x2: 300,
			cardX: 120,
			cardW: 160,
			pillW: 200,
			isCallout: true,
			visibleLeft: 180,
		});
		expect(result2.isSticky).toBe(true);
		expect(result2.x).toBe(140); // clamped to 300 - 160 = 140 so it doesn't overflow right edge
		expect(result2.width).toBe(160);
	});
});



