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

const GRAPH_HEIGHT = 200;
const LANE_COUNT = MOOD_LEVELS.length; // 5
const LANE_HEIGHT = GRAPH_HEIGHT / LANE_COUNT; // 40
/** Fraction of LANE_HEIGHT a mood bar occupies vertically. */
const MOOD_BAR_FILL_RATIO = 0.6;
const MOOD_BAR_HEIGHT = Math.round(LANE_HEIGHT * MOOD_BAR_FILL_RATIO);
const MOOD_BAR_OFFSET = Math.round((LANE_HEIGHT - MOOD_BAR_HEIGHT) / 2);
const DATE_HEADER_HEIGHT = 14;
const MIN_MONTH_LABEL_PX = 55;
const LABEL_FONT_SIZE = 10;        // must match .daylio-event-label font-size
const LABEL_LINE_HEIGHT_PX = 12;   // LABEL_FONT_SIZE × line-height (1.2)
const LABEL_INNER_H_PAD = 14;      // padding(4×2) + border(1×2) + slack(4)
const LABEL_INNER_V_PAD = 8;       // padding(2×2) + border(1×2) + slack(2)
const LABEL_ROW_GAP = 4;           // vertical gap between label rows
const LABEL_H_PAD = 6;             // horizontal gap between adjacent labels
/** Fallback text content width (px) used when canvas measurement is unavailable. */
const LABEL_DEFAULT_TEXT_WIDTH = 60;
/** Vertical gap (px) between the bottom of the graph area and the first label row. */
const LABEL_AREA_GAP = 8;
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
export const LEFT_PAD = 20;
/** Right padding (px) added after the last bar column. */
export const RIGHT_PAD = 20;

// ─── SVG helper ─────────────────────────────────────────────────────

const SVG_NS = "http://www.w3.org/2000/svg";

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

	// log(
	// 	"computeEntrySpans:",
	// 	spans.length, "span(s) from",
	// 	vaultEvents.length, "vault entr(ies)",
	// );
	return spans;
}

export interface GraphBuildContext {
	moodColors: Record<MoodLevel, string>;
	openFile: (filePath: string) => void;
	/** When false, event label cards and their connector lines are omitted. */
	showEventLabels: boolean;
	/** When set, the SVG is padded on the right so its rendered width is at
	 *  least this many pixels.  Used by graph-view to ensure the scroll
	 *  container always has a functional scroll range (scrollLeft can always
	 *  be nonzero), which keeps cursor-anchored zoom correct even when the
	 *  graph would otherwise fit entirely within the viewport. */
	minWidth?: number;
}

export interface EventTrackSpan {
	event: VaultEvent;
	startIdx: number;
	endIdx: number;
	trackIdx: number;
	textWidth: number;
	isRange: boolean;
}

export type RangeTrackSpan = EventTrackSpan;

/**
 * Greedily pack all labelled events into non-overlapping horizontal tracks (swimlanes).
 * Takes into account the text label width so text overflow never collides with adjacent events.
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
		visualWidth: number;
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
		const barWidthPx = Math.max(barWidth, (endIdx - startIdx) * stride + barWidth);
		const visualWidth = Math.max(barWidthPx, textWidth);

		validItems.push({
			event: ev,
			startIdx,
			endIdx,
			isRange,
			textWidth,
			visualWidth,
		});
	}

	// Sort by startIdx ascending, then endIdx descending
	validItems.sort((a, b) => a.startIdx - b.startIdx || b.endIdx - a.endIdx);

	const trackLastRightX: number[] = [];
	const spans: EventTrackSpan[] = [];

	for (const item of validItems) {
		const startX = LEFT_PAD + item.startIdx * stride;
		const rightEdgeX = startX + item.visualWidth + 6; // 6px gap to next item

		let assignedTrack = -1;
		for (let t = 0; t < trackLastRightX.length; t++) {
			const lastRightX = trackLastRightX[t] ?? -Infinity;
			if (lastRightX <= startX) {
				assignedTrack = t;
				trackLastRightX[t] = rightEdgeX;
				break;
			}
		}

		if (assignedTrack === -1) {
			assignedTrack = trackLastRightX.length;
			trackLastRightX.push(rightEdgeX);
		}

		spans.push({
			event: item.event,
			startIdx: item.startIdx,
			endIdx: item.endIdx,
			trackIdx: assignedTrack,
			textWidth: item.textWidth,
			isRange: item.isRange,
		});
	}

	return { spans, trackCount: trackLastRightX.length };
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
	const RANGE_TRACK_HEIGHT = 20;
	const RANGE_BAR_HEIGHT = 16;
	const RANGE_SWIMLANE_GAP = 6;

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
		? ganttTop + ganttHeight + SVG_BOTTOM_PAD
		: graphBottom + SVG_BOTTOM_PAD;

	const graphWidth = days.length * stride - BAR_GAP + LEFT_PAD + RIGHT_PAD;
	const svgWidth = Math.max(graphWidth, ctx.minWidth ?? 0);

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
		const n = day.entries.length;

		for (let j = 0; j < n; j++) {
			const entry = day.entries[j];
			if (!entry) continue;
			const lane = MOOD_TO_LANE[entry.mood];
			const laneTop = graphTop + lane * LANE_HEIGHT;
			const slotHeight = MOOD_BAR_HEIGHT / n;
			const y = laneTop + MOOD_BAR_OFFSET + j * slotHeight;
			const w = BAR_WIDTH;
			const h = slotHeight;
			const rx = Math.min(BAR_CORNER_RADIUS_MAX, w / 2, h / 2);

			moodPaths[entry.mood] +=
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
		// Pass 1 — Vertical Dotted Connector Lines (drawn behind pills)
		const connectorsGroup = svgEl("g", { class: "daylio-event-connectors" });
		for (const span of eventTracks.spans) {
			const yPill = ganttTop + span.trackIdx * RANGE_TRACK_HEIGHT;

			if (!span.isRange) {
				// Single-date event: 1 vertical dotted line
				const cx = LEFT_PAD + span.startIdx * stride + BAR_WIDTH / 2;
				connectorsGroup.appendChild(svgEl("line", {
					x1: String(cx),
					y1: "0",
					x2: String(cx),
					y2: String(yPill),
					class: "daylio-event-connector",
				}));
			} else {
				// Multi-day range event: 2 vertical dotted lines (start date and end date)
				const cxStart = LEFT_PAD + span.startIdx * stride + BAR_WIDTH / 2;
				const cxEnd = LEFT_PAD + span.endIdx * stride + BAR_WIDTH / 2;

				connectorsGroup.appendChild(svgEl("line", {
					x1: String(cxStart),
					y1: "0",
					x2: String(cxStart),
					y2: String(yPill),
					class: "daylio-event-connector",
				}));
				connectorsGroup.appendChild(svgEl("line", {
					x1: String(cxEnd),
					y1: "0",
					x2: String(cxEnd),
					y2: String(yPill),
					class: "daylio-event-connector",
				}));
			}
		}
		svg.appendChild(connectorsGroup);

		// Pass 2 — Event Swimlane Pills & Labels
		const swimlaneGroup = svgEl("g", { class: "daylio-range-swimlanes" });
		for (const span of eventTracks.spans) {
			const x1 = LEFT_PAD + span.startIdx * stride;
			const x2 = LEFT_PAD + span.endIdx * stride + BAR_WIDTH;
			const barWidthPx = x2 - x1;
			const pillWidth = Math.max(BAR_WIDTH, barWidthPx);
			const totalVisualWidth = Math.max(pillWidth, span.textWidth);
			const yPill = ganttTop + span.trackIdx * RANGE_TRACK_HEIGHT;

			const pillGroup = svgEl("g", { class: "daylio-range-pill-group" });
			const rect = svgEl("rect", {
				class: "daylio-range-pill",
				x: String(x1),
				y: String(yPill),
				width: String(pillWidth),
				height: String(RANGE_BAR_HEIGHT),
				rx: "3",
				ry: "3",
			});
			pillGroup.appendChild(rect);

			const fo = svgEl("foreignObject", {
				x: String(x1),
				y: String(yPill),
				width: String(totalVisualWidth),
				height: String(RANGE_BAR_HEIGHT),
			});
			const div = document.createElement("div");
			div.className = "daylio-range-pill-text";
			div.textContent = span.event.label ?? "";
			const dateInfo = span.isRange
				? `${span.event.date} → ${span.event.endDate}`
				: span.event.date;
			div.title = `${span.event.label} (${dateInfo})\nClick to open note`;
			fo.appendChild(div);
			pillGroup.appendChild(fo);

			const titleEl = svgEl("title");
			titleEl.textContent = `${span.event.label} (${dateInfo})\nClick to open note`;
			pillGroup.appendChild(titleEl);

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

	// log(
	// 	"buildGraphSvg: SVG dimensions",
	// 	graphWidth, "×", totalHeight,
	// 	"px,", rowTopY.length, "event label row(s),",
	// 	(performance.now() - buildStart).toFixed(2), "ms",
	// );
	return svg;
}
