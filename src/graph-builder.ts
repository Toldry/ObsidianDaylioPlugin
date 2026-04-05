import {
	MOOD_LEVELS,
	MOOD_TO_LANE,
	barGapFor,
	type MoodLevel,
	type DayData,
	type VaultEvent,
} from "./types";
import log from "./log";

// ─── Layout constants ───────────────────────────────────────────────

const GRAPH_HEIGHT = 200;
const LANE_COUNT = MOOD_LEVELS.length; // 5
const LANE_HEIGHT = GRAPH_HEIGHT / LANE_COUNT; // 40
const MOOD_BAR_HEIGHT = Math.round(LANE_HEIGHT * 0.6);
const MOOD_BAR_OFFSET = Math.round((LANE_HEIGHT - MOOD_BAR_HEIGHT) / 2);
const DATE_HEADER_HEIGHT = 44;
const MIN_MONTH_LABEL_PX = 55;
const LABEL_FONT_SIZE = 10;        // must match .daylio-event-label font-size
const LABEL_LINE_HEIGHT_PX = 12;   // LABEL_FONT_SIZE × line-height (1.2)
const LABEL_INNER_H_PAD = 14;      // padding(4×2) + border(1×2) + slack(4)
const LABEL_INNER_V_PAD = 8;       // padding(2×2) + border(1×2) + slack(2)
const LABEL_ROW_GAP = 4;           // vertical gap between label rows
const LABEL_H_PAD = 6;             // horizontal gap between adjacent labels
const LEFT_PAD = 20;

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

	log(
		"computeEntrySpans:",
		spans.length, "span(s) from",
		vaultEvents.length, "vault entr(ies)",
	);
	return spans;
}

export interface GraphBuildContext {
	moodColors: Record<MoodLevel, string>;
	openFile: (filePath: string) => void;
	/** When false, event label cards and their connector lines are omitted. */
	showEventLabels: boolean;
}

/**
 * Build the mood-history SVG.  Pure synchronous function — no file I/O.
 *
 * Performance optimisations vs. the original monolithic version:
 *   - Mood bars are merged into one `<path>` per mood level (5 paths
 *     instead of ~2 900 individual `<rect>` + `<title>` pairs).
 *   - Lane dividers use a single `<path>` instead of N-1 `<line>` elements.
 *   - Month separators use a single `<path>`.
 *   - Tooltip text is handled via a shared `<title>` repositioned on hover
 *     rather than one `<title>` per bar.
 */
export function buildGraphSvg(
	barWidth: number,
	days: DayData[],
	vaultEvents: VaultEvent[],
	ctx: GraphBuildContext,
): SVGSVGElement {
	log(
		"buildGraphSvg: barWidth =", barWidth,
		", days =", days.length,
		", events =", vaultEvents.length,
	);
	const buildStart = performance.now();
	const BAR_WIDTH = barWidth;
	const BAR_GAP = barGapFor(barWidth);
	const stride = BAR_WIDTH + BAR_GAP;

	const graphTop = DATE_HEADER_HEIGHT;
	const graphBottom = graphTop + GRAPH_HEIGHT;

	// ── Vault event lookups ──────────────────────────────────────
	const eventsByDate = new Map<string, VaultEvent>();
	for (const ev of vaultEvents) {
		eventsByDate.set(ev.date, ev);
	}

	// ── Per-label metrics + row layout (skipped when labels hidden) ─
	// Literal "\n" sequences in the YAML value (unquoted / single-
	// quoted) are treated as newlines, as are real newlines that
	// YAML double-quoting produces.
	interface LabelMetrics {
		lines: string[];
		width: number;   // foreignObject width in px
		height: number;  // foreignObject height in px
	}
	const labelMetrics = new Map<string, LabelMetrics>();
	const eventLabelRows = new Map<string, number>();
	const rowMaxHeight: number[] = [];
	const rowTopY: number[] = [];
	const labelAreaTop = graphBottom + 8;

	if (ctx.showEventLabels) {
		// Measure each label's text so the foreignObject is sized to fit.
		const measureCanvas = document.createElement("canvas");
		const measureCtx = measureCanvas.getContext("2d");
		if (measureCtx) {
			measureCtx.font =
				`${LABEL_FONT_SIZE}px system-ui, sans-serif`;
		}
		const measureLine = (text: string): number =>
			measureCtx
				? measureCtx.measureText(text).width
				: text.length * 6;

		for (const ev of eventsByDate.values()) {
			if (!ev.label) continue;
			const lines = ev.label
				.replace(/\\n/g, "\n")
				.split("\n");
			const maxLineWidth = Math.max(...lines.map(measureLine));
			const width = Math.ceil(maxLineWidth) + LABEL_INNER_H_PAD;
			const height =
				lines.length * LABEL_LINE_HEIGHT_PX + LABEL_INNER_V_PAD;
			labelMetrics.set(ev.date, { lines, width, height });
		}

		// Greedy collision-avoidance: assign each label the lowest row
		// where it doesn't overlap any already-placed label.
		const rowRightEdge: number[] = [];
		for (let i = 0; i < days.length; i++) {
			const day = days[i];
			if (!day) continue;
			const ev = eventsByDate.get(day.date);
			if (!ev?.label) continue;
			const metrics = labelMetrics.get(day.date);
			const labelWidth = metrics?.width ?? LABEL_INNER_H_PAD + 60;
			const labelHeight =
				metrics?.height ?? LABEL_LINE_HEIGHT_PX + LABEL_INNER_V_PAD;
			const cx = LEFT_PAD + i * stride + BAR_WIDTH / 2;
			const left = cx - labelWidth / 2;
			const right = cx + labelWidth / 2;
			let row = 0;
			while (
				row < rowRightEdge.length &&
				(rowRightEdge[row] ?? -Infinity) > left - LABEL_H_PAD
			) {
				row++;
			}
			rowRightEdge[row] = right;
			rowMaxHeight[row] = Math.max(
				rowMaxHeight[row] ?? 0,
				labelHeight,
			);
			eventLabelRows.set(day.date, row);
		}

		// Compute each row's top y, stacking rows with variable heights.
		let y = labelAreaTop;
		const numLabelRows = Math.max(
			1,
			eventLabelRows.size > 0
				? Math.max(...eventLabelRows.values()) + 1
				: 0,
		);
		for (let row = 0; row < numLabelRows; row++) {
			rowTopY[row] = y;
			y +=
				(rowMaxHeight[row] ??
					LABEL_LINE_HEIGHT_PX + LABEL_INNER_V_PAD) +
				LABEL_ROW_GAP;
		}
	}

	// SVG height: includes label area when visible, otherwise just the graph.
	const totalHeight = ctx.showEventLabels && rowTopY.length > 0
		? (rowTopY[rowTopY.length - 1] ?? labelAreaTop) +
		  (rowMaxHeight[rowTopY.length - 1] ??
		      LABEL_LINE_HEIGHT_PX + LABEL_INNER_V_PAD) + 4
		: graphBottom + 4;
	const graphWidth = days.length * stride - BAR_GAP + 40;

	// ── Root SVG element ─────────────────────────────────────────
	const svg = svgEl("svg", {
		width: String(graphWidth),
		height: String(totalHeight),
		viewBox: `0 0 ${graphWidth} ${totalHeight}`,
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

	// ── Month separators + labels ────────────────────────────────
	{
		let sepPath = "";
		let currentMonth = "";
		let lastLabelX = -Infinity;
		for (let i = 0; i < days.length; i++) {
			const day = days[i];
			if (!day) continue;
			const monthStr = day.date.slice(0, 7);
			if (monthStr === currentMonth) continue;
			currentMonth = monthStr;
			const x = LEFT_PAD + i * stride;
			sepPath += `M${x - 2} 0V${graphBottom}`;

			if (x - lastLabelX >= MIN_MONTH_LABEL_PX) {
				lastLabelX = x;
				const monthDate = new Date(day.date + "T00:00:00");
				const monthName = monthDate.toLocaleString("default", {
					month: "short",
				});
				const label = svgEl("text", {
					x: String(x + 2),
					y: "12",
					class: "daylio-month-label",
				});
				label.textContent = `${monthName} ${monthDate.getFullYear()}`;
				svg.appendChild(label);
			}
		}
		svg.appendChild(svgEl("path", {
			d: sepPath,
			class: "daylio-month-line",
		}));
	}

	// ── Mood bars (one <path> per mood level) ────────────────────
	// Instead of thousands of individual <rect> elements, we build
	// a single path-data string per mood and render 5 <path> nodes.
	const moodPaths: Record<MoodLevel, string> = {
		rad: "", good: "", meh: "", bad: "", awful: "",
	};
	for (let i = 0; i < days.length; i++) {
		const day = days[i];
		if (!day) continue;
		const x = LEFT_PAD + i * stride;
		for (const entry of day.entries) {
			const laneIndex = MOOD_TO_LANE[entry.mood];
			const barY = graphTop + laneIndex * LANE_HEIGHT + MOOD_BAR_OFFSET;
			// Rounded rect via path: moveTo + arc corners + lines.
			// For very small bars the radius shrinks to half the width.
			const rx = Math.min(2, BAR_WIDTH / 2);
			const w = BAR_WIDTH;
			const h = MOOD_BAR_HEIGHT;
			moodPaths[entry.mood] +=
				`M${x + rx},${barY}` +
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
			BAR_WIDTH >= 8
				? true
				: BAR_WIDTH >= 5
					? dayOfMonth % 5 === 1 || dayOfMonth === 1
					: BAR_WIDTH >= 3
						? dayOfMonth % 10 === 1 || dayOfMonth === 1
						: false;

		if (showTick) {
			const tick = svgEl("text", {
				x: String(LEFT_PAD + i * stride + BAR_WIDTH / 2),
				y: String(graphTop - 4),
				class: "daylio-date-tick",
			});
			tick.textContent = String(dayOfMonth);
			svg.appendChild(tick);
		}
	}

	// ── Event labels + connectors ────────────────────────────────
	// Two-pass rendering: connectors first (behind), labels second
	// (in front) so that crossing connector lines never obscure text.
	if (ctx.showEventLabels) {
		// Pass 1 — connector lines (drawn behind labels).
		for (let i = 0; i < days.length; i++) {
			const day = days[i];
			if (!day) continue;
			const event = eventsByDate.get(day.date);
			if (!event?.label) continue;

			const cx = LEFT_PAD + i * stride + BAR_WIDTH / 2;
			const evRow = eventLabelRows.get(day.date) ?? 0;
			const labelY = rowTopY[evRow] ?? labelAreaTop;

			svg.appendChild(svgEl("line", {
				x1: String(cx),
				y1: "0",
				x2: String(cx),
				y2: String(labelY),
				class: "daylio-event-connector",
			}));
		}

		// Pass 2 — label cards (drawn in front of connectors).
		for (let i = 0; i < days.length; i++) {
			const day = days[i];
			if (!day) continue;
			const event = eventsByDate.get(day.date);
			if (!event?.label) continue;

			const eventLabel = event.label;
			const metrics = labelMetrics.get(day.date);
			const labelWidth = metrics?.width ?? LABEL_INNER_H_PAD + 60;
			const labelHeight =
				metrics?.height ?? LABEL_LINE_HEIGHT_PX + LABEL_INNER_V_PAD;
			const lines = metrics?.lines ?? [eventLabel];

			const cx = LEFT_PAD + i * stride + BAR_WIDTH / 2;
			const evRow = eventLabelRows.get(day.date) ?? 0;
			const labelY = rowTopY[evRow] ?? labelAreaTop;

			const fo = svgEl("foreignObject", {
				x: String(cx - labelWidth / 2),
				y: String(labelY),
				width: String(labelWidth),
				height: String(labelHeight),
			});

			const labelDiv = document.createElement("div");
			labelDiv.className = "daylio-event-label";
			labelDiv.title =
				`${lines.join("\n")}\n${event.date}\nClick to open note`;

			for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
				if (lineIdx > 0) {
					labelDiv.appendChild(document.createElement("br"));
				}
				labelDiv.appendChild(
					document.createTextNode(lines[lineIdx] ?? ""),
				);
			}

			const filePath = event.filePath;
			labelDiv.addEventListener("click", (evt) => {
				evt.preventDefault();
				evt.stopPropagation();
				ctx.openFile(filePath);
			});

			fo.appendChild(labelDiv);
			svg.appendChild(fo);
		}
	}

	// ── Shared hover labels (date + entry filename) ─────────────
	// Two stacked text elements shown at the bottom of the graph
	// area while the cursor is over a day column:
	//   hoverDateLabel  — the ISO date of the hovered day
	//   hoverNameLabel  — the vault entry filename, with date prefix
	//                     and .md extension stripped
	const hoverDateLabel = svgEl("text", {
		class: "daylio-hover-date-label",
		y: String(graphBottom - 14),
		visibility: "hidden",
	});
	svg.appendChild(hoverDateLabel);

	const hoverNameLabel = svgEl("text", {
		class: "daylio-hover-name-label",
		y: String(graphBottom - 4),
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

	log(
		"buildGraphSvg: SVG dimensions",
		graphWidth, "×", totalHeight,
		"px,", rowTopY.length, "event label row(s),",
		(performance.now() - buildStart).toFixed(2), "ms",
	);
	return svg;
}
