import {
	MOOD_LEVELS,
	MOOD_TO_LANE,
	barGapFor,
	type MoodLevel,
	type DayData,
	type VaultEvent,
} from "./types";

// ─── Layout constants ───────────────────────────────────────────────

const GRAPH_HEIGHT = 200;
const LANE_COUNT = MOOD_LEVELS.length; // 5
const LANE_HEIGHT = GRAPH_HEIGHT / LANE_COUNT; // 40
const MOOD_BAR_HEIGHT = Math.round(LANE_HEIGHT * 0.6);
const MOOD_BAR_OFFSET = Math.round((LANE_HEIGHT - MOOD_BAR_HEIGHT) / 2);
const DATE_HEADER_HEIGHT = 44;
const MIN_MONTH_LABEL_PX = 55;
const LABEL_WIDTH = 100;
const LABEL_ROW_HEIGHT = 22;
const LABEL_H_PAD = 6;
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

// ─── Public interface ───────────────────────────────────────────────

export interface GraphBuildContext {
	moodColors: Record<MoodLevel, string>;
	openFile: (filePath: string) => void;
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
	const sortedEvents = [...vaultEvents].sort(
		(a, b) => a.date.localeCompare(b.date),
	);

	// ── Active event per day (two-pointer) ───────────────────────
	const dayActiveEvents: (VaultEvent | undefined)[] = [];
	{
		let ePtr = 0;
		let current: VaultEvent | undefined;
		for (const day of days) {
			while (
				ePtr < sortedEvents.length &&
				(sortedEvents[ePtr]?.date ?? "") <= day.date
			) {
				current = sortedEvents[ePtr];
				ePtr++;
			}
			dayActiveEvents.push(current);
		}
	}

	// ── Event label row assignment (greedy collision avoidance) ──
	const eventLabelRows = new Map<string, number>();
	{
		const rowRightEdge: number[] = [];
		for (let i = 0; i < days.length; i++) {
			const day = days[i];
			if (!day) continue;
			const ev = eventsByDate.get(day.date);
			if (!ev) continue;
			const cx = LEFT_PAD + i * stride + BAR_WIDTH / 2;
			const left = cx - LABEL_WIDTH / 2;
			const right = cx + LABEL_WIDTH / 2;
			let row = 0;
			while (
				row < rowRightEdge.length &&
				(rowRightEdge[row] ?? -Infinity) > left - LABEL_H_PAD
			) {
				row++;
			}
			rowRightEdge[row] = right;
			eventLabelRows.set(day.date, row);
		}
	}
	const numLabelRows = Math.max(
		1,
		eventLabelRows.size > 0
			? Math.max(...eventLabelRows.values()) + 1
			: 0,
	);
	const labelAreaTop = graphBottom + 8;
	const totalHeight = labelAreaTop + numLabelRows * LABEL_ROW_HEIGHT + 4;
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
	for (let i = 0; i < days.length; i++) {
		const day = days[i];
		if (!day) continue;
		const event = eventsByDate.get(day.date);
		if (!event) continue;

		const cx = LEFT_PAD + i * stride + BAR_WIDTH / 2;
		const evRow = eventLabelRows.get(day.date) ?? 0;
		const labelY = labelAreaTop + evRow * LABEL_ROW_HEIGHT;

		svg.appendChild(svgEl("line", {
			x1: String(cx),
			y1: "0",
			x2: String(cx),
			y2: String(labelY),
			class: "daylio-event-connector",
		}));

		const fo = svgEl("foreignObject", {
			x: String(cx - LABEL_WIDTH / 2),
			y: String(labelY),
			width: String(LABEL_WIDTH),
			height: String(LABEL_ROW_HEIGHT - 2),
		});

		const labelDiv = document.createElement("div");
		labelDiv.className = "daylio-event-label";
		labelDiv.textContent = event.label;
		labelDiv.title =
			`${event.label}\n${event.date}\nClick to open note`;

		const filePath = event.filePath;
		labelDiv.addEventListener("click", (evt) => {
			evt.preventDefault();
			evt.stopPropagation();
			ctx.openFile(filePath);
		});

		fo.appendChild(labelDiv);
		svg.appendChild(fo);
	}

	// ── Shared hover-date label ──────────────────────────────────
	const hoverDateLabel = svgEl("text", {
		class: "daylio-hover-date-label",
		y: String(graphBottom - 6),
		visibility: "hidden",
	});
	svg.appendChild(hoverDateLabel);

	// ── Event group overlays (range + per-day) ───────────────────
	interface EventGroup {
		event: VaultEvent;
		startIdx: number;
		endIdx: number;
	}
	const eventGroups: EventGroup[] = [];
	{
		let currentGroup: EventGroup | null = null;
		for (let i = 0; i < days.length; i++) {
			const activeEvent = dayActiveEvents[i];
			if (
				activeEvent &&
				currentGroup &&
				activeEvent.filePath === currentGroup.event.filePath
			) {
				currentGroup.endIdx = i;
			} else if (activeEvent) {
				currentGroup = {
					event: activeEvent,
					startIdx: i,
					endIdx: i,
				};
				eventGroups.push(currentGroup);
			} else {
				currentGroup = null;
			}
		}
	}

	for (const group of eventGroups) {
		const g = svgEl("g", { class: "daylio-event-group" });

		const groupTitle = svgEl("title");
		groupTitle.textContent =
			`${group.event.label} · ${group.event.date}\nClick to open note`;
		g.appendChild(groupTitle);

		const startX = LEFT_PAD + group.startIdx * stride;
		const endX = LEFT_PAD + group.endIdx * stride + BAR_WIDTH;

		g.appendChild(svgEl("rect", {
			x: String(startX),
			y: String(graphTop),
			width: String(endX - startX),
			height: String(GRAPH_HEIGHT),
			class: "daylio-range-bg",
		}));

		const groupFilePath = group.event.filePath;
		const clickHandler = (evt: MouseEvent): void => {
			evt.stopPropagation();
			ctx.openFile(groupFilePath);
		};

		for (let i = group.startIdx; i <= group.endIdx; i++) {
			const dx = LEFT_PAD + i * stride;
			const dayOverlay = svgEl("rect", {
				x: String(dx),
				y: String(graphTop),
				width: String(BAR_WIDTH),
				height: String(GRAPH_HEIGHT),
				class: "daylio-day-overlay",
			});
			dayOverlay.addEventListener("click", clickHandler);

			const dayDate = days[i]?.date ?? "";
			dayOverlay.addEventListener("mouseenter", () => {
				hoverDateLabel.textContent = dayDate;
				hoverDateLabel.setAttribute("x", String(dx + BAR_WIDTH / 2));
				hoverDateLabel.setAttribute("visibility", "visible");
			});
			dayOverlay.addEventListener("mouseleave", () => {
				hoverDateLabel.setAttribute("visibility", "hidden");
			});
			g.appendChild(dayOverlay);
		}

		svg.appendChild(g);
	}

	return svg;
}
