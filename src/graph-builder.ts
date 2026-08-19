import {
	MOOD_LEVELS,
	MOOD_TO_LANE,
	barGapFor,
	BAR_WIDTH_MAX,
	BAR_WIDTH_YEAR_ONLY_THRESHOLD,
	type MoodLevel,
	type DayData,
	type VaultEvent,
} from "./types";

// ─── Layout constants ───────────────────────────────────────────────

/** Total height (px) of the mood lane area. */
const GRAPH_HEIGHT = 200;
/** Number of mood lanes (one per mood level). */
const LANE_COUNT = MOOD_LEVELS.length; // 5
/** Height (px) of each mood lane. */
const LANE_HEIGHT = GRAPH_HEIGHT / LANE_COUNT; // 40
/** Fraction of LANE_HEIGHT a mood bar occupies vertically. */
const MOOD_BAR_FILL_RATIO = 0.6;
/** Absolute height (px) of each mood bar. */
const MOOD_BAR_HEIGHT = Math.round(LANE_HEIGHT * MOOD_BAR_FILL_RATIO);
/** Vertical offset (px) to centre the bar within its lane. */
const MOOD_BAR_OFFSET = Math.round((LANE_HEIGHT - MOOD_BAR_HEIGHT) / 2);
/** Height (px) of the date header strip above the graph. */
const DATE_HEADER_HEIGHT = 14;
/** Minimum horizontal distance (px) between adjacent month labels. */
const MIN_MONTH_LABEL_PX = 55;
/** Font size (px) for event label text — must match .daylio-event-label in CSS. */
const LABEL_FONT_SIZE = 10;
/** Maximum corner radius (px) for mood bar rounded rectangles. */
const BAR_CORNER_RADIUS_MAX = 2;
/** How many pixels left of a month/year boundary the separator line and label are placed. */
const SEPARATOR_X_OFFSET = 2;
/** Y coordinate (px) of month/year labels inside the date header strip. */
const MONTH_LABEL_Y = 12;
/** Extra vertical pixels added below the last row of content to pad the SVG bottom. */
const SVG_BOTTOM_PAD = 4;
/** How far (px) above graphTop the date-of-month tick labels are drawn. */
const DATE_TICK_OFFSET = 4;
/** Bar width threshold above which every day gets a date tick. */
const DATE_TICK_THRESHOLD_FULL = BAR_WIDTH_MAX;
/** Bar width threshold above which every-5th-day ticks are shown. */
const DATE_TICK_THRESHOLD_COARSE = 5;
/** Bar width threshold above which every-10th-day ticks are shown. */
const DATE_TICK_THRESHOLD_MEDIUM = 3;
/** Day-of-month modulus for coarse (every-5th) tick rendering. */
const DATE_TICK_INTERVAL_COARSE = 5;
/** Day-of-month modulus for fine (every-10th) tick rendering. */
const DATE_TICK_INTERVAL_FINE = 10;
/** Distance (px) above graphBottom for the hovered-day ISO date label. */
const HOVER_DATE_LABEL_OFFSET = 14;
/** Distance (px) above graphBottom for the hovered-day entry name label. */
const HOVER_NAME_LABEL_OFFSET = 4;
/** Left padding (px) before the first bar column. */
export const LEFT_PAD = 20;
/** Right padding (px) added after the last bar column. */
export const RIGHT_PAD = 20;

/**
 * Curated 6-color palette of distinct purple tones for swimlane track cycling.
 * Each track index maps to a distinct shade of purple so vertically stacked
 * events are distinguishable while maintaining a unified purple theme.
 */
export const TRACK_COLORS: readonly string[] = [
	"#7c6fe0",  // Obsidian Purple / Violet (primary)
	"#a855f7",  // Bright Amethyst (vibrant)
	"#c084fc",  // Orchid / Lilac (light, luminous)
	"#6366f1",  // Indigo-Purple (deep cool violet)
	"#9333ea",  // Royal Purple (deep, rich)
	"#d8b4fe",  // Soft Lavender (pastel)
];

export interface StickyLabelParams {
	x1: number;
	x2: number;
	cardX: number;
	cardW: number;
	pillW: number;
	isCallout: boolean;
	visibleLeft: number;
	padding?: number;
}

export interface StickyLabelResult {
	x: number;
	width: number;
	isSticky: boolean;
}

/**
 * Computes sticky label position and width for range events when their start
 * date is scrolled out of frame to the left.
 */
export function computeStickyLabelPosition(
	params: StickyLabelParams,
): StickyLabelResult {
	const { x1, x2, cardX, cardW, pillW, isCallout, visibleLeft, padding = 8 } = params;

	if (visibleLeft > x1 && visibleLeft < x2 - padding) {
		const minWidth = isCallout ? cardW : Math.min(cardW, 40);
		const maxStickyX = x2 - minWidth;
		const stickyX = Math.max(x1, Math.min(visibleLeft + padding, maxStickyX));
		const width = isCallout ? cardW : Math.max(20, x2 - stickyX);

		return {
			x: Math.round(stickyX),
			width: Math.round(width),
			isSticky: true,
		};
	}

	return {
		x: Math.round(cardX),
		width: Math.round(isCallout ? cardW : pillW),
		isSticky: false,
	};
}

// ─── SVG helper ─────────────────────────────────────────────────────

const SVG_NS = "http://www.w3.org/2000/svg";

/** Create an SVG element and set attributes in one call. */
function svgEl(tag: string, attrs?: Record<string, string>): SVGElement {
	const el = document.createElementNS(SVG_NS, tag);
	if (attrs) {
		for (const [k, v] of Object.entries(attrs)) {
			el.setAttribute(k, v);
		}
	}
	return el;
}

// ─── Entry span computation ──────────────────────────────────────────

/** A contiguous span of days that share the same active vault entry. */
export interface EntrySpan {
	entry: VaultEvent;
	/** Index into the `days` array where this span starts (inclusive). */
	startIdx: number;
	/** Index into the `days` array where this span ends (inclusive). */
	endIdx: number;
}

/**
 * Given a list of days and a list of vault entries (all dated notes,
 * labelled or not), compute which entry is "active" for each day —
 * the most recently started entry on or before that day — then
 * collapse consecutive days sharing the same active entry into spans.
 *
 * This drives the two-level overlay: a wide background for the whole
 * span and a per-day hover target inside it.
 *
 * Pure function — no DOM, no I/O.
 */
export function computeEntrySpans(
	days: DayData[],
	vaultEvents: VaultEvent[],
): EntrySpan[] {
	const sortedEntries = [...vaultEvents].sort(
		(a, b) => a.date.localeCompare(b.date),
	);

	// Two-pointer: `current` is always the most recent entry whose date
	// is on or before the current day.  Days before the first entry
	// have no active entry and are left without an overlay.
	const dayActiveEntry: (VaultEvent | undefined)[] = [];
	{
		let ePtr = 0;
		let current: VaultEvent | undefined;
		for (const day of days) {
			while (
				ePtr < sortedEntries.length &&
				(sortedEntries[ePtr]?.date ?? "") <= day.date
			) {
				current = sortedEntries[ePtr];
				ePtr++;
			}
			dayActiveEntry.push(current);
		}
	}

	// Collapse consecutive days with the same active entry into spans.
	const spans: EntrySpan[] = [];
	let currentSpan: EntrySpan | null = null;
	for (let i = 0; i < days.length; i++) {
		const activeEntry = dayActiveEntry[i];
		if (
			activeEntry &&
			currentSpan &&
			activeEntry.filePath === currentSpan.entry.filePath
		) {
			currentSpan.endIdx = i;
		} else if (activeEntry) {
			currentSpan = { entry: activeEntry, startIdx: i, endIdx: i };
			spans.push(currentSpan);
		} else {
			currentSpan = null;
		}
	}

	return spans;
}

/** Count and percentage of a single mood level within a date range. */
export interface MoodProportion {
	/** Which mood this proportion describes. */
	mood: MoodLevel;
	/** Absolute count of entries with this mood. */
	count: number;
	/** Percentage of total entries (0–100). */
	percentage: number;
}

/** Aggregated mood distribution across a date range. */
export interface RangeMoodSummary {
	/** Per-mood counts and percentages. */
	proportions: MoodProportion[];
	/** Total number of mood entries in the range (may exceed totalDays). */
	totalEntries: number;
	/** Number of calendar days in the range. */
	totalDays: number;
}

/** Data passed to the tooltip hover callback for rendering. */
export interface RangeTooltipData {
	label: string;
	isRange: boolean;
	date: string;
	endDate?: string;
	moodSummary: RangeMoodSummary;
	trackColor: string;
}

/**
 * Computes mood counts and percentages for all Daylio entries between
 * startIdx and endIdx (inclusive).
 */
export function computeRangeMoodProportions(
	days: DayData[],
	startIdx: number,
	endIdx: number,
): RangeMoodSummary {
	const counts: Record<MoodLevel, number> = {
		rad: 0,
		good: 0,
		meh: 0,
		bad: 0,
		awful: 0,
	};
	let totalEntries = 0;
	const safeStart = Math.max(0, Math.min(startIdx, days.length - 1));
	const safeEnd = Math.max(safeStart, Math.min(endIdx, days.length - 1));

	for (let i = safeStart; i <= safeEnd; i++) {
		const day = days[i];
		if (!day) continue;
		for (const entry of day.entries) {
			if (entry && entry.mood in counts) {
				counts[entry.mood]++;
				totalEntries++;
			}
		}
	}

	const totalDays = safeEnd - safeStart + 1;
	const proportions: MoodProportion[] = MOOD_LEVELS.map((mood) => ({
		mood,
		count: counts[mood],
		percentage: totalEntries > 0 ? (counts[mood] / totalEntries) * 100 : 0,
	}));

	return {
		proportions,
		totalEntries,
		totalDays,
	};
}

/** Context object passed to `buildGraphSvg()` with colours, callbacks, and flags. */
export interface GraphBuildContext {
	/** Hex colour for each mood level. */
	moodColors: Record<MoodLevel, string>;
	/** Callback to open a vault file when the user clicks an event. */
	openFile: (filePath: string) => void;
	/** When false, event label cards and their connector lines are omitted. */
	showEventLabels: boolean;
	/** When set, the SVG is padded on the right so its rendered width is at
	 *  least this many pixels.  Used by graph-view to ensure the scroll
	 *  container always has a functional scroll range (scrollLeft can always
	 *  be nonzero), which keeps cursor-anchored zoom correct even when the
	 *  graph would otherwise fit entirely within the viewport. */
	minWidth?: number;
	onEventHover?: (event: MouseEvent, data: RangeTooltipData) => void;
	onEventMove?: (event: MouseEvent) => void;
	onEventLeave?: () => void;
}

/** A labelled event assigned to a specific swimlane track. */
export interface EventTrackSpan {
	/** The vault event this span represents. */
	event: VaultEvent;
	/** Start index in the `days` array (inclusive). */
	startIdx: number;
	/** End index in the `days` array (inclusive). */
	endIdx: number;
	/** Zero-based swimlane track index. */
	trackIdx: number;
	/** Measured text width (px) of the label. */
	textWidth: number;
	/** True when the event spans multiple days. */
	isRange: boolean;
	/** True when the label card overflows the date span and floats as a callout. */
	isCallout: boolean;
	/** X position of the label card. */
	cardX: number;
	/** Width of the label card. */
	cardW: number;
}

export type RangeTrackSpan = EventTrackSpan;

/**
 * Greedily pack all labelled events into non-overlapping horizontal tracks (swimlanes).
 * 1. Range events (isRange = true) are ALWAYS packed into tracks strictly above point events.
 * 2. Events with sooner start dates are prioritized for higher tracks (lower trackIdx).
 * 3. Uses Floating Callout Cards when text exceeds the date span width so text is always
 *    cleanly enclosed inside a badge container.
 */
export function packEventsIntoTracks(
	vaultEvents: VaultEvent[],
	days: DayData[],
	stride = 10,
	barWidth = 8,
	measureTextFn?: (text: string) => number,
): { spans: EventTrackSpan[]; trackCount: number } {
	if (days.length === 0) return { spans: [], trackCount: 0 };

	const dateIdxMap = new Map<string, number>();
	for (let i = 0; i < days.length; i++) {
		const d = days[i];
		if (d) dateIdxMap.set(d.date, i);
	}

	const validItems: {
		event: VaultEvent;
		startIdx: number;
		endIdx: number;
		isRange: boolean;
		textWidth: number;
		isCallout: boolean;
		cardX: number;
		cardW: number;
		visualStartX: number;
		visualEndX: number;
	}[] = [];

	for (const ev of vaultEvents) {
		if (!ev.label) continue;
		const startIdx = dateIdxMap.get(ev.date);
		if (startIdx === undefined) continue;

		let endIdx = ev.endDate ? dateIdxMap.get(ev.endDate) : startIdx;
		if (endIdx === undefined) {
			const lastDay = days[days.length - 1];
			if (lastDay && ev.endDate && ev.endDate >= lastDay.date) {
				endIdx = days.length - 1;
			} else {
				endIdx = startIdx;
			}
		}

		if (endIdx < startIdx) {
			endIdx = startIdx;
		}

		const isRange = endIdx > startIdx;
		const textWidth = measureTextFn
			? Math.ceil(measureTextFn(ev.label)) + 12
			: ev.label.length * 6 + 12;
		const x1 = LEFT_PAD + startIdx * stride;
		const x2 = LEFT_PAD + endIdx * stride + barWidth;
		const barWidthPx = Math.max(barWidth, x2 - x1);
		const cardWidth = textWidth + 14;
		const isCallout = barWidthPx < cardWidth;

		let cardX = x1;
		let cardW = barWidthPx;
		let visualStartX = x1;
		let visualEndX = x2;

		if (isCallout) {
			const cx = (x1 + x2) / 2;
			cardX = Math.max(4, Math.round(cx - cardWidth / 2));
			cardW = cardWidth;
			visualStartX = Math.min(x1, cardX);
			visualEndX = Math.max(x2, cardX + cardWidth);
		}

		validItems.push({
			event: ev,
			startIdx,
			endIdx,
			isRange,
			textWidth,
			isCallout,
			cardX,
			cardW,
			visualStartX,
			visualEndX,
		});
	}

	// 1. Separate range events from point events
	const rangeItems = validItems.filter((i) => i.isRange);
	const pointItems = validItems.filter((i) => !i.isRange);

	// 2. Sort range events: sooner start date first; if tied, longer range first
	rangeItems.sort(
		(a, b) =>
			a.startIdx - b.startIdx ||
			(b.endIdx - b.startIdx) - (a.endIdx - a.startIdx) ||
			a.visualStartX - b.visualStartX,
	);

	// 3. Sort point events: sooner start date first
	pointItems.sort(
		(a, b) => a.startIdx - b.startIdx || a.visualStartX - b.visualStartX,
	);

	const spans: EventTrackSpan[] = [];
	const trackIntervals: { startX: number; endX: number }[][] = [];
	const PADDING = 6;

	function assignTrack(item: (typeof validItems)[number]): number {
		let trackIdx = 0;
		while (true) {
			if (trackIdx >= trackIntervals.length) {
				trackIntervals.push([{ startX: item.visualStartX, endX: item.visualEndX }]);
				return trackIdx;
			}

			const intervals = trackIntervals[trackIdx]!;
			let hasCollision = false;
			for (const interval of intervals) {
				if (
					!(
						item.visualEndX + PADDING <= interval.startX ||
						item.visualStartX >= interval.endX + PADDING
					)
				) {
					hasCollision = true;
					break;
				}
			}

			if (!hasCollision) {
				intervals.push({ startX: item.visualStartX, endX: item.visualEndX });
				return trackIdx;
			}

			trackIdx++;
		}
	}

	// 4. Pack range events first (so range events always take higher tracks locally over point events)
	for (const item of rangeItems) {
		const trackIdx = assignTrack(item);
		spans.push({
			event: item.event,
			startIdx: item.startIdx,
			endIdx: item.endIdx,
			trackIdx,
			textWidth: item.textWidth,
			isRange: true,
			isCallout: item.isCallout,
			cardX: item.cardX,
			cardW: item.cardW,
		});
	}

	// 5. Pack point events into the highest available tracks at their local X location
	for (const item of pointItems) {
		const trackIdx = assignTrack(item);
		spans.push({
			event: item.event,
			startIdx: item.startIdx,
			endIdx: item.endIdx,
			trackIdx,
			textWidth: item.textWidth,
			isRange: false,
			isCallout: item.isCallout,
			cardX: item.cardX,
			cardW: item.cardW,
		});
	}

	return { spans, trackCount: trackIntervals.length };
}

/** Backwards-compatibility alias for packEventsIntoTracks */
export const packRangeEventsIntoTracks = (
	vaultEvents: VaultEvent[],
	days: DayData[],
): { spans: RangeTrackSpan[]; trackCount: number } => {
	return packEventsIntoTracks(vaultEvents, days, 10, 8);
};

/**
 * Build the mood-history SVG.  Pure synchronous function — no file I/O.
 */
export function buildGraphSvg(
	barWidth: number,
	days: DayData[],
	vaultEvents: VaultEvent[],
	ctx: GraphBuildContext,
): SVGSVGElement {
	const BAR_WIDTH = barWidth;
	const BAR_GAP = barGapFor(barWidth);
	const stride = BAR_WIDTH + BAR_GAP;

	const graphTop = DATE_HEADER_HEIGHT;
	const graphBottom = graphTop + GRAPH_HEIGHT;

	// ── Event Swimlane Track Layout ─────────────────────────────
	const RANGE_TRACK_HEIGHT = 30;
	const RANGE_SWIMLANE_GAP = 8;
	const TOP_BAR_HEIGHT = 5;
	const TOP_BAR_Y_OFFSET = 2;
	const CALLOUT_GAP = 3;
	const CALLOUT_CARD_HEIGHT = 18;
	const CALLOUT_CARD_Y_OFFSET = TOP_BAR_Y_OFFSET + TOP_BAR_HEIGHT + CALLOUT_GAP;
	const WIDE_PILL_HEIGHT = 20;
	const WIDE_PILL_Y_OFFSET = 4;

	// Measure canvas for accurate label text widths
	const measureCanvas = document.createElement("canvas");
	const measureCtx = measureCanvas.getContext("2d");
	if (measureCtx) {
		measureCtx.font = `${LABEL_FONT_SIZE}px system-ui, sans-serif`;
	}
	const measureLine = (text: string): number =>
		measureCtx ? measureCtx.measureText(text).width : text.length * 6;

	const eventTracks = ctx.showEventLabels
		? packEventsIntoTracks(vaultEvents, days, stride, BAR_WIDTH, measureLine)
		: { spans: [], trackCount: 0 };

	const ganttTop = graphBottom + RANGE_SWIMLANE_GAP;
	const ganttHeight = eventTracks.trackCount > 0
		? eventTracks.trackCount * RANGE_TRACK_HEIGHT
		: 0;

	// SVG height: includes swimlane tracks when visible, otherwise just the graph.
	const totalHeight = ganttHeight > 0
		? ganttTop + ganttHeight + SVG_BOTTOM_PAD + 4
		: graphBottom + SVG_BOTTOM_PAD;

	const graphWidth = days.length * stride - BAR_GAP + LEFT_PAD + RIGHT_PAD;
	let maxVisualX = graphWidth;
	for (const span of eventTracks.spans) {
		const spanRight = span.isCallout
			? span.cardX + span.cardW + RIGHT_PAD
			: LEFT_PAD + span.endIdx * stride + BAR_WIDTH + RIGHT_PAD;
		if (spanRight > maxVisualX) {
			maxVisualX = spanRight;
		}
	}
	const svgWidth = Math.max(maxVisualX, ctx.minWidth ?? 0);

	// ── Root SVG element ─────────────────────────────────────────
	const svg = svgEl("svg", {
		width: String(svgWidth),
		height: String(totalHeight),
		viewBox: `0 0 ${svgWidth} ${totalHeight}`,
		class: "daylio-graph-svg",
	}) as SVGSVGElement;

	// ── Lane dividers (single <path>) ────────────────────────────
	{
		let d = "";
		for (let lane = 1; lane < LANE_COUNT; lane++) {
			const y = graphTop + lane * LANE_HEIGHT;
			d += `M0 ${y}H${graphWidth}`;
		}
		svg.appendChild(svgEl("path", {
			d,
			class: "daylio-lane-divider",
		}));
	}

	// ── Month/year separators + labels ───────────────────────────
	{
		const yearOnlyLabels = BAR_WIDTH <= BAR_WIDTH_YEAR_ONLY_THRESHOLD;
		let monthPath = ""; // non-year-start separators
		let yearPath  = ""; // year-start separators
		let currentMonth = "";
		let lastLabelX = -Infinity;

		for (let i = 0; i < days.length; i++) {
			const day = days[i];
			if (!day) continue;
			const monthStr = day.date.slice(0, 7);
			if (monthStr === currentMonth) continue;
			currentMonth = monthStr;
			const x = LEFT_PAD + i * stride;
			const isYearStart = monthStr.endsWith("-01");

			if (isYearStart) {
				yearPath += `M${x - SEPARATOR_X_OFFSET} ${graphTop}V${graphBottom}`;
			} else {
				monthPath += `M${x - SEPARATOR_X_OFFSET} ${graphTop}V${graphBottom}`;
			}

			if (yearOnlyLabels && !isYearStart) continue;

			if (x - lastLabelX >= MIN_MONTH_LABEL_PX) {
				lastLabelX = x;
				if (yearOnlyLabels) {
					const year = monthStr.slice(0, 4);
					const label = svgEl("text", {
						x: String(x - SEPARATOR_X_OFFSET),
						y: String(MONTH_LABEL_Y),
						"text-anchor": "middle",
						class: "daylio-month-label",
					});
					label.textContent = year;
					svg.appendChild(label);
				} else {
					const monthDate = new Date(day.date + "T00:00:00");
					const monthName = monthDate.toLocaleString("default", {
						month: "short",
					});
					const label = svgEl("text", {
						x: String(x - SEPARATOR_X_OFFSET),
						y: String(MONTH_LABEL_Y),
						"text-anchor": "middle",
						class: "daylio-month-label",
					});
					label.textContent = `${monthName} ${monthDate.getFullYear()}`;
					svg.appendChild(label);
				}
			}
		}

		if (monthPath) {
			svg.appendChild(svgEl("path", {
				d: monthPath,
				class: "daylio-month-line",
			}));
		}
		if (yearPath) {
			svg.appendChild(svgEl("path", {
				d: yearPath,
				class: "daylio-year-line",
			}));
		}
	}

	// ── Mood bars (one <path> per mood level) ────────────────────
	const moodPaths: Record<MoodLevel, string> = {
		rad: "",
		good: "",
		meh: "",
		bad: "",
		awful: "",
	};

	for (let i = 0; i < days.length; i++) {
		const day = days[i];
		if (!day) continue;
		const colX = LEFT_PAD + i * stride;
		const uniqueMoods = new Set(day.entries.map((e) => e.mood));

		for (const mood of uniqueMoods) {
			const lane = MOOD_TO_LANE[mood];
			const laneTop = graphTop + lane * LANE_HEIGHT;
			const y = laneTop + MOOD_BAR_OFFSET;
			const w = BAR_WIDTH;
			const h = MOOD_BAR_HEIGHT;
			const rx = Math.min(BAR_CORNER_RADIUS_MAX, w / 2, h / 2);

			moodPaths[mood] +=
				`M${colX + rx},${y}` +
				`h${w - 2 * rx}` +
				`a${rx},${rx} 0 0 1 ${rx},${rx}` +
				`v${h - 2 * rx}` +
				`a${rx},${rx} 0 0 1 ${-rx},${rx}` +
				`h${-(w - 2 * rx)}` +
				`a${rx},${rx} 0 0 1 ${-rx},${-rx}` +
				`v${-(h - 2 * rx)}` +
				`a${rx},${rx} 0 0 1 ${rx},${-rx}Z`;
		}
	}
	for (const mood of MOOD_LEVELS) {
		if (!moodPaths[mood]) continue;
		svg.appendChild(svgEl("path", {
			d: moodPaths[mood],
			fill: ctx.moodColors[mood],
			class: "daylio-mood-bar",
		}));
	}

	// ── Date ticks ───────────────────────────────────────────────
	for (let i = 0; i < days.length; i++) {
		const day = days[i];
		if (!day) continue;
		const dayOfMonth = parseInt(day.date.slice(8, 10), 10);
		const showTick =
			BAR_WIDTH >= DATE_TICK_THRESHOLD_FULL
				? true
				: BAR_WIDTH >= DATE_TICK_THRESHOLD_COARSE
					? dayOfMonth % DATE_TICK_INTERVAL_COARSE === 1 ||
					  dayOfMonth === 1
					: BAR_WIDTH >= DATE_TICK_THRESHOLD_MEDIUM
						? dayOfMonth % DATE_TICK_INTERVAL_FINE === 1 ||
						  dayOfMonth === 1
						: false;

		if (showTick) {
			const tick = svgEl("text", {
				x: String(LEFT_PAD + i * stride + BAR_WIDTH / 2),
				y: String(graphTop - DATE_TICK_OFFSET),
				class: "daylio-date-tick",
			});
			tick.textContent = String(dayOfMonth);
			svg.appendChild(tick);
		}
	}

	// ── Unified Event Swimlanes & Dotted Connectors ──────────────
	if (ctx.showEventLabels && eventTracks.spans.length > 0) {
		// Event Swimlane Groups (each group contains its vertical connectors, bars/pills, and card)
		const swimlaneGroup = svgEl("g", { class: "daylio-range-swimlanes" });
		for (const span of eventTracks.spans) {
			const trackColor = TRACK_COLORS[span.trackIdx % TRACK_COLORS.length]!;
			const x1 = LEFT_PAD + span.startIdx * stride;
			const x2 = LEFT_PAD + span.endIdx * stride + BAR_WIDTH;
			const barWidthPx = x2 - x1;
			const pillWidth = Math.max(BAR_WIDTH, barWidthPx);
			const yTrack = ganttTop + span.trackIdx * RANGE_TRACK_HEIGHT;

			const pillGroup = svgEl("g", { class: "daylio-range-pill-group" });
			const moodSummary = computeRangeMoodProportions(
				days,
				span.startIdx,
				span.endIdx,
			);
			const tooltipData: RangeTooltipData = {
				label: span.event.label ?? "",
				isRange: span.isRange,
				date: span.event.date,
				endDate: span.event.endDate,
				moodSummary,
				trackColor,
			};

			// 1. Vertical Dotted Connector Lines (rendered first inside group so they sit behind bars/pills)
			const yTop = span.isRange
				? (span.isCallout
					? yTrack + TOP_BAR_Y_OFFSET
					: yTrack + WIDE_PILL_Y_OFFSET)
				: yTrack + CALLOUT_CARD_Y_OFFSET;

			if (!span.isRange) {
				// Single-date event: 1 vertical dotted line
				const cx = LEFT_PAD + span.startIdx * stride + BAR_WIDTH / 2;
				pillGroup.appendChild(svgEl("line", {
					x1: String(cx),
					y1: "0",
					x2: String(cx),
					y2: String(yTop),
					class: "daylio-event-connector",
					stroke: trackColor,
				}));
			} else {
				// Multi-day range event: 2 vertical dotted lines (start date and end date)
				const cxStart = LEFT_PAD + span.startIdx * stride + BAR_WIDTH / 2;
				const cxEnd = LEFT_PAD + span.endIdx * stride + BAR_WIDTH / 2;

				pillGroup.appendChild(svgEl("line", {
					x1: String(cxStart),
					y1: "0",
					x2: String(cxStart),
					y2: String(yTop),
					class: "daylio-event-connector",
					stroke: trackColor,
				}));
				pillGroup.appendChild(svgEl("line", {
					x1: String(cxEnd),
					y1: "0",
					x2: String(cxEnd),
					y2: String(yTop),
					class: "daylio-event-connector",
					stroke: trackColor,
				}));
			}

			if (span.isCallout) {
				if (span.isRange) {
					// 2. Top bar spanning exact start and end dates (range events only)
					const topBarY = yTrack + TOP_BAR_Y_OFFSET;
					const topBar = svgEl("rect", {
						class: "daylio-range-top-bar",
						x: String(x1),
						y: String(topBarY),
						width: String(pillWidth),
						height: String(TOP_BAR_HEIGHT),
						rx: "2.5",
						ry: "2.5",
						fill: trackColor,
						stroke: trackColor,
					});
					pillGroup.appendChild(topBar);

					// 3. Short stem connecting center of top bar to floating card
					const cx = (x1 + x2) / 2;
					const stemY1 = topBarY + TOP_BAR_HEIGHT;
					const stemY2 = yTrack + CALLOUT_CARD_Y_OFFSET;
					const stem = svgEl("line", {
						class: "daylio-range-callout-stem",
						x1: String(cx),
						y1: String(stemY1),
						x2: String(cx),
						y2: String(stemY2),
						stroke: trackColor,
					});
					pillGroup.appendChild(stem);
				}
				// Single-day events: no top bar, connector drops straight to card

				// 3. Floating Callout Card
				const foAttrs: Record<string, string> = {
					x: String(span.cardX),
					y: String(yTrack + CALLOUT_CARD_Y_OFFSET),
					width: String(span.cardW),
					height: String(CALLOUT_CARD_HEIGHT + 4),
					style: "overflow: visible;",
				};
				if (span.isRange) {
					foAttrs.class = "daylio-range-fo";
					foAttrs["data-x1"] = String(x1);
					foAttrs["data-x2"] = String(x2);
					foAttrs["data-card-x"] = String(span.cardX);
					foAttrs["data-card-w"] = String(span.cardW);
					foAttrs["data-pill-w"] = String(pillWidth);
					foAttrs["data-is-callout"] = "true";
				}
				const fo = svgEl("foreignObject", foAttrs);
				const div = document.createElement("div");
				div.className = "daylio-range-callout-card";
				div.textContent = span.event.label ?? "";
				div.style.borderColor = trackColor;
				fo.appendChild(div);
				pillGroup.appendChild(fo);
			} else {
				// Wide range event: full pill with text enclosed
				const pillY = yTrack + WIDE_PILL_Y_OFFSET;
				const rect = svgEl("rect", {
					class: "daylio-range-pill",
					x: String(x1),
					y: String(pillY),
					width: String(pillWidth),
					height: String(WIDE_PILL_HEIGHT),
					rx: "4",
					ry: "4",
					fill: trackColor,
					"fill-opacity": "0.25",
					stroke: trackColor,
				});
				pillGroup.appendChild(rect);

				const foAttrs: Record<string, string> = {
					x: String(x1),
					y: String(pillY),
					width: String(pillWidth),
					height: String(WIDE_PILL_HEIGHT + 4),
					style: "overflow: visible;",
				};
				if (span.isRange) {
					foAttrs.class = "daylio-range-fo";
					foAttrs["data-x1"] = String(x1);
					foAttrs["data-x2"] = String(x2);
					foAttrs["data-card-x"] = String(x1);
					foAttrs["data-card-w"] = String(span.cardW);
					foAttrs["data-pill-w"] = String(pillWidth);
					foAttrs["data-is-callout"] = "false";
				}
				const fo = svgEl("foreignObject", foAttrs);
				const div = document.createElement("div");
				div.className = "daylio-range-pill-text";
				div.textContent = span.event.label ?? "";
				fo.appendChild(div);
				pillGroup.appendChild(fo);
			}

			// Tooltip listeners on the entire pillGroup
			pillGroup.addEventListener("mouseenter", (evt: MouseEvent) => {
				ctx.onEventHover?.(evt, tooltipData);
			});
			pillGroup.addEventListener("mousemove", (evt: MouseEvent) => {
				ctx.onEventMove?.(evt);
			});
			pillGroup.addEventListener("mouseleave", () => {
				ctx.onEventLeave?.();
			});

			const filePath = span.event.filePath;
			pillGroup.addEventListener("click", (evt) => {
				evt.preventDefault();
				evt.stopPropagation();
				ctx.openFile(filePath);
			});

			swimlaneGroup.appendChild(pillGroup);
		}
		svg.appendChild(swimlaneGroup);
	}

	// ── Shared hover labels (date + entry filename) ─────────────
	// Two stacked text elements shown at the bottom of the graph
	// area while the cursor is over a day column:
	//   hoverDateLabel  — the ISO date of the hovered day
	//   hoverNameLabel  — the vault entry filename, with date prefix
	//                     and .md extension stripped
	const hoverDateLabel = svgEl("text", {
		class: "daylio-hover-date-label",
		y: String(graphBottom - HOVER_DATE_LABEL_OFFSET),
		visibility: "hidden",
	});
	svg.appendChild(hoverDateLabel);

	const hoverNameLabel = svgEl("text", {
		class: "daylio-hover-name-label",
		y: String(graphBottom - HOVER_NAME_LABEL_OFFSET),
		visibility: "hidden",
	});
	svg.appendChild(hoverNameLabel);

	// ── Vault entry overlays (wide range-bg + per-day hover targets) ─
	// Each vault entry owns a span of days running from its date up to
	// (not including) the next entry's date.  Two visual layers:
	//   1. A wide background rect covering the whole span — shown faintly
	//      whenever any part of the group is hovered.
	//   2. Per-day overlay rects — shown more prominently on direct hover
	//      and used as the click / date-label target.
	const entrySpans = computeEntrySpans(days, vaultEvents);

	for (const span of entrySpans) {
		const g = svgEl("g", { class: "daylio-entry-group" });

		const startX = LEFT_PAD + span.startIdx * stride;
		const endX = LEFT_PAD + span.endIdx * stride + stride;

		g.appendChild(svgEl("rect", {
			x: String(startX),
			y: String(graphTop),
			width: String(endX - startX),
			height: String(GRAPH_HEIGHT),
			class: "daylio-range-bg",
		}));

		const filePath = span.entry.filePath;
		const clickHandler = (evt: MouseEvent): void => {
			evt.stopPropagation();
			ctx.openFile(filePath);
		};

		for (let i = span.startIdx; i <= span.endIdx; i++) {
			const dx = LEFT_PAD + i * stride;
			const dayOverlay = svgEl("rect", {
				x: String(dx),
				y: String(graphTop),
				width: String(stride),
				height: String(GRAPH_HEIGHT),
				class: "daylio-day-overlay",
			});
			dayOverlay.addEventListener("click", clickHandler);

			const dayDate = days[i]?.date ?? "";
			// Strip date prefix (YYYY-MM-DD followed by optional space/dash)
			// and .md extension to get a human-readable entry name.
			const entryName = filePath
				.split("/")
				.pop()!
				.replace(/\.md$/i, "")
				.replace(/^\d{4}-\d{2}-\d{2}[\s-]*/, "");
			const labelX = String(dx + BAR_WIDTH / 2);
			dayOverlay.addEventListener("mouseenter", () => {
				hoverDateLabel.textContent = dayDate;
				hoverDateLabel.setAttribute("x", labelX);
				hoverDateLabel.setAttribute("visibility", "visible");
				hoverNameLabel.textContent = entryName;
				hoverNameLabel.setAttribute("x", labelX);
				hoverNameLabel.setAttribute(
					"visibility", entryName ? "visible" : "hidden",
				);
			});
			dayOverlay.addEventListener("mouseleave", () => {
				hoverDateLabel.setAttribute("visibility", "hidden");
				hoverNameLabel.setAttribute("visibility", "hidden");
			});
			g.appendChild(dayOverlay);
		}

		svg.appendChild(g);
	}

	return svg;
}
