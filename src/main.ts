import {
	addIcon,
	App,
	ItemView,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
	WorkspaceLeaf,
} from "obsidian";

// ─── Custom ribbon icon ──────────────────────────────────────────────
// A simple smiley face that mirrors Daylio's own app icon: a green
// circle with two eyes and a smile.  Registered once at module load
// time so it is available before any plugin instance is created.
// The SVG is designed on a 24×24 grid to match the Lucide icon set
// that Obsidian uses for all its built-in icons.
const DAYLIO_ICON_ID = "daylio-face";
// Obsidian renders addIcon content in a 0 0 100 100 viewBox.
addIcon(
	DAYLIO_ICON_ID,
	`<circle cx="50" cy="50" r="48" fill="#4CAF50"/>
	 <circle cx="36" cy="40" r="7" fill="#1a1a1a"/>
	 <circle cx="64" cy="40" r="7" fill="#1a1a1a"/>
	 <path d="M30 60 Q50 80 70 60"
	       stroke="#1a1a1a" stroke-width="7"
	       fill="none" stroke-linecap="round"/>`
);

// ─── Types ──────────────────────────────────────────────────────────

/** The five mood levels Daylio uses, ranked worst → best. */
export type MoodLevel = "awful" | "bad" | "meh" | "good" | "rad";

export const MOOD_LEVELS: MoodLevel[] = ["awful", "bad", "meh", "good", "rad"];

const MOOD_RANK: Record<MoodLevel, number> = {
	awful: 0,
	bad: 1,
	meh: 2,
	good: 3,
	rad: 4,
};

export interface MoodEntry {
	date: string;       // "YYYY-MM-DD"
	time: string;       // "HH:MM"
	mood: MoodLevel;
}

/** A single day, potentially with multiple mood entries. */
export interface DayData {
	date: string;
	entries: MoodEntry[];
}

/** An event label sourced from a vault note's frontmatter. */
export interface VaultEvent {
	date: string;       // "YYYY-MM-DD"
	label: string;
	filePath: string;   // path inside vault so we can navigate to it
}

// ─── Default colours (matching the Daylio palette) ──────────────────

const DEFAULT_MOOD_COLORS: Record<MoodLevel, string> = {
	rad: "#f78c1e",
	good: "#41a766",
	meh: "#9056a3",
	bad: "#5579a7",
	awful: "#6a777c",
};

// ─── Settings ───────────────────────────────────────────────────────

interface DaylioGraphSettings {
	csvPath: string;
	moodColors: Record<MoodLevel, string>;
	/** Pixel width of each bar column — controls zoom level. */
	barWidth: number;
}

const DEFAULT_SETTINGS: DaylioGraphSettings = {
	csvPath: "",
	moodColors: { ...DEFAULT_MOOD_COLORS },
	barWidth: 8,
};

// ─── CSV parsing ────────────────────────────────────────────────────

/**
 * Parse a Daylio CSV export into an array of MoodEntry objects.
 *
 * Expected columns (in order):
 *   full_date, date, weekday, time, mood, activities, note_title, note
 *
 * We only care about full_date (YYYY-MM-DD), time, and mood.
 */
export function parseDaylioCsv(raw: string): MoodEntry[] {
	const lines = raw.split(/\r?\n/).filter((line) => line.trim() !== "");
	if (lines.length < 2) return [];

	const entries: MoodEntry[] = [];
	// Skip the header row
	for (let i = 1; i < lines.length; i++) {
		const fields = parseCsvLine(lines[i] ?? "");
		const fullDate = fields[0]?.trim();
		const time = fields[3]?.trim() ?? "";
		const moodRaw = fields[4]?.trim().toLowerCase() ?? "";

		if (!fullDate || !isMoodLevel(moodRaw)) continue;

		entries.push({ date: fullDate, time, mood: moodRaw });
	}
	return entries;
}

/**
 * Minimal CSV line parser that respects quoted fields
 * (Daylio's "note" column can contain commas and newlines).
 */
export function parseCsvLine(line: string): string[] {
	const result: string[] = [];
	let current = "";
	let inQuotes = false;

	for (let i = 0; i < line.length; i++) {
		const char = line[i];
		if (inQuotes) {
			if (char === '"') {
				if (i + 1 < line.length && line[i + 1] === '"') {
					current += '"';
					i++; // skip escaped quote
				} else {
					inQuotes = false;
				}
			} else {
				current += char;
			}
		} else {
			if (char === '"') {
				inQuotes = true;
			} else if (char === ",") {
				result.push(current);
				current = "";
			} else {
				current += char;
			}
		}
	}
	result.push(current);
	return result;
}

export function isMoodLevel(value: string): value is MoodLevel {
	return MOOD_LEVELS.includes(value as MoodLevel);
}

/**
 * Group entries by date and sort days chronologically.
 * Within each day, entries are sorted by time ascending.
 */
export function groupByDay(entries: MoodEntry[]): DayData[] {
	const map = new Map<string, MoodEntry[]>();
	for (const entry of entries) {
		const existing = map.get(entry.date);
		if (existing) {
			existing.push(entry);
		} else {
			map.set(entry.date, [entry]);
		}
	}

	const days: DayData[] = [];
	for (const [date, dayEntries] of map) {
		dayEntries.sort((a, b) => a.time.localeCompare(b.time));
		days.push({ date, entries: dayEntries });
	}

	days.sort((a, b) => a.date.localeCompare(b.date));
	return days;
}

// ─── Vault event scanner ────────────────────────────────────────────

export const DATE_PREFIX_REGEX = /^(\d{4}-\d{2}-\d{2})/;

/**
 * Scan the vault's metadata cache for notes whose frontmatter
 * contains a `daylio_event` property. The note's filename must
 * begin with YYYY-MM-DD.
 */
export function scanVaultEvents(app: App): VaultEvent[] {
	const events: VaultEvent[] = [];
	const files = app.vault.getMarkdownFiles();

	for (const file of files) {
		const dateMatch = file.basename.match(DATE_PREFIX_REGEX);
		if (!dateMatch?.[1]) continue;

		const cache = app.metadataCache.getFileCache(file);
		const eventValue = cache?.frontmatter?.["daylio_event"];
		if (typeof eventValue !== "string" || eventValue.trim() === "") {
			continue;
		}

		events.push({
			date: dateMatch[1],
			label: eventValue.trim(),
			filePath: file.path,
		});
	}

	return events;
}

// ─── The graph view ─────────────────────────────────────────────────

const VIEW_TYPE_DAYLIO = "daylio-mood-graph-view";

/**
 * Gap between bar columns, in pixels.  Shrinks at extreme zoom-out so
 * the gap doesn't dominate over the bars themselves.
 *
 *   barWidth ≥ 2  →  gap = 2
 *   barWidth ≥ 1  →  gap = 1
 *   barWidth < 1  →  gap = 0
 */
function barGapFor(barWidth: number): number {
	return barWidth >= 2 ? 2 : barWidth >= 1 ? 1 : 0;
}

class DaylioGraphView extends ItemView {
	private plugin: DaylioGraphPlugin;
	private scrollContainer: HTMLElement | null = null;
	/**
	 * Fraction (0–1) of horizontal scroll position, where 1 = rightmost.
	 * Saved before each re-render and restored afterwards so that zooming
	 * doesn't jump the viewport to a different part of the timeline.
	 */
	private scrollRatio = 1;
	/** Reference to the zoom slider so the wheel handler can update it. */
	private zoomSlider: HTMLInputElement | null = null;
	/** Debounce timer ID for Ctrl+wheel zoom saves. */
	private zoomDebounceTimer: ReturnType<typeof setTimeout> | undefined;
	/** Parsed CSV rows — cached so zoom redraws skip the async file read. */
	private cachedDays: DayData[] = [];
	/** Vault events — cached alongside cachedDays. */
	private cachedVaultEvents: VaultEvent[] = [];

	constructor(leaf: WorkspaceLeaf, plugin: DaylioGraphPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_DAYLIO;
	}

	getDisplayText(): string {
		return "Daylio Mood Graph";
	}

	getIcon(): string {
		return "bar-chart-2";
	}

	async onOpen(): Promise<void> {
		await this.renderGraph();
	}

	async onClose(): Promise<void> {
		clearTimeout(this.zoomDebounceTimer);
		this.containerEl.empty();
	}

	/** Full re-render — called on open and when settings change. */
	async renderGraph(): Promise<void> {
		const container = this.containerEl.children[1] as HTMLElement;

		// Preserve scroll position across re-renders (e.g. when zooming).
		if (this.scrollContainer) {
			const maxScroll =
				this.scrollContainer.scrollWidth -
				this.scrollContainer.clientWidth;
			this.scrollRatio =
				maxScroll > 0
					? this.scrollContainer.scrollLeft / maxScroll
					: 1;
		}

		container.empty();
		container.addClass("daylio-graph-root");

		// ── Load CSV ────────────────────────────────────────────
		const csvPath = this.plugin.settings.csvPath;
		if (!csvPath) {
			container.createEl("p", {
				text: "No CSV path configured. Open the Daylio Mood Graph settings to set the path to your Daylio export.",
				cls: "daylio-graph-notice",
			});
			return;
		}

		const csvFile = this.app.vault.getAbstractFileByPath(csvPath);
		if (!(csvFile instanceof TFile)) {
			container.createEl("p", {
				text: `CSV file not found at "${csvPath}". Check the path in settings.`,
				cls: "daylio-graph-notice",
			});
			return;
		}

		let csvText: string;
		try {
			csvText = await this.app.vault.read(csvFile);
		} catch {
			container.createEl("p", {
				text: "Failed to read the CSV file.",
				cls: "daylio-graph-notice",
			});
			return;
		}

		const allEntries = parseDaylioCsv(csvText);
		if (allEntries.length === 0) {
			container.createEl("p", {
				text: "No valid mood entries found in the CSV.",
				cls: "daylio-graph-notice",
			});
			return;
		}

		// ── Zoom toolbar ────────────────────────────────────────
		const toolbar = container.createDiv({ cls: "daylio-graph-toolbar" });
		toolbar.createSpan({ text: "Zoom", cls: "daylio-zoom-label" });

		// Helper: step the slider by ±delta, fire redraw + save.
		const stepZoom = (delta: number): void => {
			const newWidth = Math.max(
				0.5,
				Math.min(16, this.plugin.settings.barWidth + delta)
			);
			if (newWidth === this.plugin.settings.barWidth) return;
			slider.value = String(newWidth);
			// Re-use the input-event handler logic inline.
			if (this.scrollContainer) {
				const viewportX =
					this.scrollContainer.clientWidth / 2;
				const svgX =
					this.scrollContainer.scrollLeft + viewportX;
				const oldBW = this.plugin.settings.barWidth;
				this.quickRedraw(newWidth, {
					svgX,
					viewportX,
					oldStride: oldBW + barGapFor(oldBW),
				});
			}
			void this.plugin.saveSettings();
		};

		const minusBtn = toolbar.createEl("button", {
			text: "−",
			cls: "daylio-zoom-btn",
		});
		minusBtn.setAttribute("aria-label", "Zoom out");
		minusBtn.addEventListener("click", () => stepZoom(-0.5));

		const slider = toolbar.createEl("input") as HTMLInputElement;
		slider.type = "range";
		slider.min = "0.5";
		slider.max = "16";
		slider.step = "0.5";
		slider.value = String(this.plugin.settings.barWidth);
		slider.addClass("daylio-zoom-slider");
		this.zoomSlider = slider;
		// Live redraw while dragging — anchor viewport centre so the
		// visible portion of the timeline stays roughly constant.
		slider.addEventListener("input", () => {
			const newWidth = parseFloat(slider.value);
			if (
				newWidth === this.plugin.settings.barWidth ||
				!this.scrollContainer
			) return;
			const viewportX =
				this.scrollContainer.clientWidth / 2;
			const svgX =
				this.scrollContainer.scrollLeft + viewportX;
			const oldBW = this.plugin.settings.barWidth;
			const oldStride = oldBW + barGapFor(oldBW);
			this.quickRedraw(newWidth, {
				svgX,
				viewportX,
				oldStride,
			});
		});
		// Persist once the slider is released (data already rendered).
		slider.addEventListener("change", async () => {
			await this.plugin.saveSettings();
		});

		const plusBtn = toolbar.createEl("button", {
			text: "+",
			cls: "daylio-zoom-btn",
		});
		plusBtn.setAttribute("aria-label", "Zoom in");
		plusBtn.addEventListener("click", () => stepZoom(0.5));

		// ── Collect vault events + cache parsed data ────────────
		this.cachedVaultEvents = scanVaultEvents(this.app);

		// ── Mood legend ─────────────────────────────────────────
		const legend = container.createDiv({ cls: "daylio-graph-legend" });
		for (const mood of MOOD_LEVELS) {
			const item = legend.createDiv({ cls: "daylio-legend-item" });
			const swatch = item.createSpan({ cls: "daylio-legend-swatch" });
			swatch.style.backgroundColor =
				this.plugin.settings.moodColors[mood];
			item.createSpan({ text: mood, cls: "daylio-legend-label" });
		}

		// ── Graph area (horizontally scrollable) ────────────────
		this.scrollContainer = container.createDiv({
			cls: "daylio-graph-scroll",
		});

		// Wheel: vertical axis → horizontal scroll.
		// Ctrl+wheel: zoom anchored to the cursor column.
		this.scrollContainer.addEventListener("wheel", (evt) => {
			evt.preventDefault();
			if (evt.ctrlKey) {
				// Finer wheel steps when already zoomed out.
				const step =
					this.plugin.settings.barWidth <= 2 ? 0.5 : 1;
				const delta = evt.deltaY < 0 ? step : -step;
				const newWidth = Math.max(
					0.5,
					Math.min(16, this.plugin.settings.barWidth + delta)
				);
				if (newWidth !== this.plugin.settings.barWidth) {
					const rect =
						this.scrollContainer!.getBoundingClientRect();
					const viewportX = evt.clientX - rect.left;
					const svgX =
						this.scrollContainer!.scrollLeft + viewportX;
					const oldBW = this.plugin.settings.barWidth;
					const oldStride =
						oldBW + barGapFor(oldBW);
					this.quickRedraw(newWidth, {
						svgX,
						viewportX,
						oldStride,
					});
					clearTimeout(this.zoomDebounceTimer);
					this.zoomDebounceTimer = setTimeout(async () => {
						await this.plugin.saveSettings();
					}, 300);
				}
			} else {
				// Map vertical scroll → horizontal pan.
				// deltaX covers trackpad horizontal gestures too.
				this.scrollContainer!.scrollLeft +=
					evt.deltaX + evt.deltaY;
			}
		}, { passive: false });

		// Cache days so quickRedraw() can rebuild the SVG without
		// re-reading the CSV.
		this.cachedDays = groupByDay(allEntries);

		this.scrollContainer.appendChild(
			this.buildGraphSvg(this.plugin.settings.barWidth)
		);

		// Restore scroll position (or default to rightmost = most recent).
		requestAnimationFrame(() => {
			if (this.scrollContainer) {
				const maxScroll =
					this.scrollContainer.scrollWidth -
					this.scrollContainer.clientWidth;
				this.scrollContainer.scrollLeft =
					maxScroll * this.scrollRatio;
			}
		});
	}

	// ── buildGraphSvg ───────────────────────────────────────────────
	// Pure (synchronous) SVG builder.  Reads this.cachedDays and
	// this.cachedVaultEvents so it can be called cheaply on every zoom
	// change without touching the file system.
	private buildGraphSvg(barWidth: number): SVGSVGElement {
		const days = this.cachedDays;

		// ── Layout constants ────────────────────────────────────
		const BAR_WIDTH = barWidth;
		const BAR_GAP = barGapFor(barWidth);

		const GRAPH_HEIGHT = 200;
		const LANE_COUNT = MOOD_LEVELS.length; // 5
		const LANE_HEIGHT = GRAPH_HEIGHT / LANE_COUNT; // 40 px
		const MOOD_BAR_HEIGHT = Math.round(LANE_HEIGHT * 0.6);
		const MOOD_BAR_OFFSET = Math.round(
			(LANE_HEIGHT - MOOD_BAR_HEIGHT) / 2
		);

		// Lane 0 = top = "rad" (best mood).
		const MOOD_TO_LANE: Record<MoodLevel, number> = {
			rad:   0,
			good:  1,
			meh:   2,
			bad:   3,
			awful: 4,
		};

		const DATE_HEADER_HEIGHT = 44;
		// graphTop / graphBottom are needed before the SVG element is
		// created (for TOTAL_HEIGHT, which depends on label rows).
		const graphTop    = DATE_HEADER_HEIGHT;
		const graphBottom = graphTop + GRAPH_HEIGHT;

		// ── Vault event lookups ──────────────────────────────────
		// eventsByDate: label on the exact date the note starts.
		// sortedEvents: all events in date order for the two-pointer.
		const eventsByDate = new Map<string, VaultEvent>();
		for (const ev of this.cachedVaultEvents) {
			eventsByDate.set(ev.date, ev);
		}
		const sortedEvents = [...this.cachedVaultEvents].sort(
			(a, b) => a.date.localeCompare(b.date)
		);

		// ── Pre-compute active event per day (two-pointer) ───────
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

		// ── Pre-compute event label rows (greedy collision avoidance) ──
		// Each event label occupies a horizontal interval.  We greedily
		// assign the lowest row where the interval doesn't collide with
		// any already-placed label in that row, then stagger y-positions.
		const LABEL_WIDTH      = 100; // px — same value used when rendering
		const LABEL_ROW_HEIGHT = 22;  // px per staggered row
		const LABEL_H_PAD      = 6;   // minimum horizontal gap between labels
		const eventLabelRows   = new Map<string, number>(); // date → row
		{
			const rowRightEdge: number[] = [];
			for (let i = 0; i < days.length; i++) {
				const day = days[i];
				if (!day) continue;
				const ev = eventsByDate.get(day.date);
				if (!ev) continue;
				const cx = 20 + i * (BAR_WIDTH + BAR_GAP) + BAR_WIDTH / 2;
				const left  = cx - LABEL_WIDTH / 2;
				const right = cx + LABEL_WIDTH / 2;
				let row = 0;
				while (
					row < rowRightEdge.length &&
					(rowRightEdge[row] ?? -Infinity) > left - LABEL_H_PAD
				) { row++; }
				rowRightEdge[row] = right;
				eventLabelRows.set(day.date, row);
			}
		}
		const numLabelRows = Math.max(1, eventLabelRows.size > 0
			? Math.max(...eventLabelRows.values()) + 1
			: 0
		);
		// 8 px gap from graphBottom, then rows stacked downward.
		const LABEL_AREA_TOP = graphBottom + 8;
		const TOTAL_HEIGHT   = LABEL_AREA_TOP + numLabelRows * LABEL_ROW_HEIGHT + 4;

		const graphWidth =
			days.length * (BAR_WIDTH + BAR_GAP) - BAR_GAP + 40;

		const svg = document.createElementNS(
			"http://www.w3.org/2000/svg",
			"svg"
		);
		svg.setAttribute("width", String(graphWidth));
		svg.setAttribute("height", String(TOTAL_HEIGHT));
		svg.setAttribute(
			"viewBox",
			`0 0 ${graphWidth} ${TOTAL_HEIGHT}`
		);
		svg.addClass("daylio-graph-svg");

		// ── Lane dividers ────────────────────────────────────────
		// Layout (top → bottom):  date-header | graph bars | event labels
		for (let lane = 1; lane < LANE_COUNT; lane++) {
			const laneY = graphTop + lane * LANE_HEIGHT;
			const divider = document.createElementNS(
				"http://www.w3.org/2000/svg",
				"line"
			);
			divider.setAttribute("x1", "0");
			divider.setAttribute("y1", String(laneY));
			divider.setAttribute("x2", String(graphWidth));
			divider.setAttribute("y2", String(laneY));
			divider.setAttribute("class", "daylio-lane-divider");
			svg.appendChild(divider);
		}

		// ── Month separator lines and labels ─────────────────────
		// Month separator line is always drawn.  The text label is only
		// drawn when there is enough horizontal space so that adjacent
		// labels don't collide (~55 px minimum — enough for "Sep 2021").
		const MIN_MONTH_LABEL_PX = 55;
		let currentMonth = "";
		let lastMonthLabelX = -Infinity;
		for (let i = 0; i < days.length; i++) {
			const day = days[i];
			if (!day) continue;
			const monthStr = day.date.slice(0, 7);
			if (monthStr !== currentMonth) {
				currentMonth = monthStr;
				const x = 20 + i * (BAR_WIDTH + BAR_GAP);

				const line = document.createElementNS(
					"http://www.w3.org/2000/svg",
					"line"
				);
				line.setAttribute("x1", String(x - 2));
				line.setAttribute("y1", "0");
				line.setAttribute("x2", String(x - 2));
				line.setAttribute(
					"y2",
					String(graphBottom)
				);
				line.setAttribute("class", "daylio-month-line");
				svg.appendChild(line);

				if (x - lastMonthLabelX >= MIN_MONTH_LABEL_PX) {
					lastMonthLabelX = x;
					const monthLabel = document.createElementNS(
						"http://www.w3.org/2000/svg",
						"text"
					);
					const monthDate = new Date(
						day.date + "T00:00:00"
					);
					const monthName = monthDate.toLocaleString(
						"default",
						{ month: "short" }
					);
					monthLabel.textContent =
						`${monthName} ${monthDate.getFullYear()}`;
					monthLabel.setAttribute("x", String(x + 2));
					monthLabel.setAttribute("y", "12");
					monthLabel.setAttribute(
						"class",
						"daylio-month-label"
					);
					svg.appendChild(monthLabel);
				}
			}
		}

		// ── Draw bars and date ticks ─────────────────────────────
		for (let i = 0; i < days.length; i++) {
			const day = days[i];
			if (!day) continue;
			const x = 20 + i * (BAR_WIDTH + BAR_GAP);

			for (const entry of day.entries) {
				const laneIndex = MOOD_TO_LANE[entry.mood];
				const barY =
					graphTop +
					laneIndex * LANE_HEIGHT +
					MOOD_BAR_OFFSET;

				const rect = document.createElementNS(
					"http://www.w3.org/2000/svg",
					"rect"
				);
				rect.setAttribute("x", String(x));
				rect.setAttribute("y", String(barY));
				rect.setAttribute(
					"width",
					String(BAR_WIDTH)
				);
				rect.setAttribute(
					"height",
					String(MOOD_BAR_HEIGHT)
				);
				rect.setAttribute("rx", "2");
				rect.setAttribute(
					"fill",
					this.plugin.settings.moodColors[entry.mood]
				);

				const title = document.createElementNS(
					"http://www.w3.org/2000/svg",
					"title"
				);
				title.textContent =
					`${day.date} ${entry.time} — ${entry.mood}`;
				rect.appendChild(title);
				svg.appendChild(rect);
			}

			// Date tick — density scales with zoom level.
			const dayOfMonth = parseInt(
				day.date.slice(8, 10),
				10
			);
			// At extreme zoom-out (< 3 px/bar) date ticks are too
			// small to be useful; suppress them entirely.  The month
			// separator lines still provide temporal orientation.
			const showTick =
				BAR_WIDTH >= 8 ? true
				: BAR_WIDTH >= 5
					? dayOfMonth % 5 === 1 || dayOfMonth === 1
				: BAR_WIDTH >= 3
					? dayOfMonth % 10 === 1 || dayOfMonth === 1
				: false;

			if (showTick) {
				const tick = document.createElementNS(
					"http://www.w3.org/2000/svg",
					"text"
				);
				tick.textContent = String(dayOfMonth);
				tick.setAttribute(
					"x",
					String(x + BAR_WIDTH / 2)
				);
				tick.setAttribute(
					"y",
					String(graphTop - 4)
				);
				tick.setAttribute("class", "daylio-date-tick");
				svg.appendChild(tick);
			}

			// ── Event label (if any) ─────────────────────────
			const event = eventsByDate.get(day.date);
			if (event) {
				// Connector runs from graph bottom down to this
				// event's staggered row.
				const evRow  = eventLabelRows.get(day.date) ?? 0;
				const labelY = LABEL_AREA_TOP + evRow * LABEL_ROW_HEIGHT;
				const connector = document.createElementNS(
					"http://www.w3.org/2000/svg",
					"line"
				);
				connector.setAttribute(
					"x1",
					String(x + BAR_WIDTH / 2)
				);
				connector.setAttribute("y1", "0");
				connector.setAttribute(
					"x2",
					String(x + BAR_WIDTH / 2)
				);
				connector.setAttribute(
					"y2",
					String(labelY)
				);
				connector.setAttribute(
					"class",
					"daylio-event-connector"
				);
				svg.appendChild(connector);

				const fo = document.createElementNS(
					"http://www.w3.org/2000/svg",
					"foreignObject"
				);
				fo.setAttribute(
					"x",
					String(x + BAR_WIDTH / 2 - LABEL_WIDTH / 2)
				);
				fo.setAttribute("y", String(labelY));
				fo.setAttribute("width", String(LABEL_WIDTH));
				fo.setAttribute(
					"height",
					String(LABEL_ROW_HEIGHT - 2)
				);

				const labelDiv = document.createElement("div");
				labelDiv.className = "daylio-event-label";
				labelDiv.textContent = event.label;
				labelDiv.title =
					`${event.label}\n${event.date}` +
					`\nClick to open note`;

				const filePath = event.filePath;
				labelDiv.addEventListener("click", (evt) => {
					evt.preventDefault();
					evt.stopPropagation();
					const targetFile =
						this.app.vault.getAbstractFileByPath(
							filePath
						);
					if (targetFile instanceof TFile) {
						this.app.workspace
							.getLeaf(false)
							.openFile(targetFile);
					} else {
						new Notice(
							`Could not find note: ${filePath}`
						);
					}
				});

				fo.appendChild(labelDiv);
				svg.appendChild(fo);

				}
		}

		// ── Shared hover-date label ──────────────────────────────
		// A single <text> element repositioned by JS on day mouseenter.
		// Sits just below the graph bottom, centred on the hovered column.
		const hoverDateLabel = document.createElementNS(
			"http://www.w3.org/2000/svg",
			"text"
		);
		hoverDateLabel.setAttribute(
			"class",
			"daylio-hover-date-label"
		);
		hoverDateLabel.setAttribute(
			"y",
			String(graphBottom - 6)  // just inside the graph bottom edge
		);
		hoverDateLabel.setAttribute("visibility", "hidden");
		svg.appendChild(hoverDateLabel);

		// ── Event groups: range-bg + per-day overlays ────────────
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
					activeEvent.filePath ===
						currentGroup.event.filePath
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
			const g = document.createElementNS(
				"http://www.w3.org/2000/svg",
				"g"
			);
			g.setAttribute("class", "daylio-event-group");

			const groupTitle = document.createElementNS(
				"http://www.w3.org/2000/svg",
				"title"
			);
			groupTitle.textContent =
				`${group.event.label} · ${group.event.date}` +
				`\nClick to open note`;
			g.appendChild(groupTitle);

			const startX =
				20 + group.startIdx * (BAR_WIDTH + BAR_GAP);
			const endX =
				20 +
				group.endIdx * (BAR_WIDTH + BAR_GAP) +
				BAR_WIDTH;
			const rangeBg = document.createElementNS(
				"http://www.w3.org/2000/svg",
				"rect"
			);
			rangeBg.setAttribute("x", String(startX));
			rangeBg.setAttribute("y", String(graphTop));
			rangeBg.setAttribute(
				"width",
				String(endX - startX)
			);
			rangeBg.setAttribute(
				"height",
				String(GRAPH_HEIGHT)
			);
			rangeBg.setAttribute("class", "daylio-range-bg");
			g.appendChild(rangeBg);

			const groupFilePath = group.event.filePath;
			const clickHandler = (evt: MouseEvent): void => {
				evt.stopPropagation();
				const target =
					this.app.vault.getAbstractFileByPath(
						groupFilePath
					);
				if (target instanceof TFile) {
					this.app.workspace
						.getLeaf(false)
						.openFile(target);
				} else {
					new Notice(
						`Could not find note: ${groupFilePath}`
					);
				}
			};

			for (
				let i = group.startIdx;
				i <= group.endIdx;
				i++
			) {
				const dx = 20 + i * (BAR_WIDTH + BAR_GAP);
				const dayOverlay = document.createElementNS(
					"http://www.w3.org/2000/svg",
					"rect"
				);
				dayOverlay.setAttribute("x", String(dx));
				dayOverlay.setAttribute(
					"y",
					String(graphTop)
				);
				dayOverlay.setAttribute(
					"width",
					String(BAR_WIDTH)
				);
				dayOverlay.setAttribute(
					"height",
					String(GRAPH_HEIGHT)
				);
				dayOverlay.setAttribute(
					"class",
					"daylio-day-overlay"
				);
				dayOverlay.addEventListener(
					"click",
					clickHandler
				);
				// Show the date of this specific column on hover.
				const dayDate = days[i]?.date ?? "";
				dayOverlay.addEventListener("mouseenter", () => {
					hoverDateLabel.textContent = dayDate;
					hoverDateLabel.setAttribute(
						"x",
						String(dx + BAR_WIDTH / 2)
					);
					hoverDateLabel.setAttribute(
						"visibility",
						"visible"
					);
				});
				dayOverlay.addEventListener("mouseleave", () => {
					hoverDateLabel.setAttribute(
						"visibility",
						"hidden"
					);
				});
				g.appendChild(dayOverlay);
			}

			svg.appendChild(g);
		}

		return svg;
	}

	// ── quickRedraw ──────────────────────────────────────────────────
	// Replaces the SVG inside the scroll container without a full
	// renderGraph() call (no CSV read, no DOM rebuild of toolbar/legend).
	// Anchor keeps the day column under the cursor/viewport-centre pinned.
	private quickRedraw(
		newWidth: number,
		anchor?: {
			svgX: number;
			viewportX: number;
			oldStride: number;
		}
	): void {
		if (!this.scrollContainer || this.cachedDays.length === 0) {
			return;
		}
		this.plugin.settings.barWidth = newWidth;
		if (this.zoomSlider) {
			this.zoomSlider.value = String(newWidth);
		}
		this.scrollContainer.empty();
		this.scrollContainer.appendChild(
			this.buildGraphSvg(newWidth)
		);
		// Restore scroll in the next frame once layout is flushed.
		requestAnimationFrame(() => {
			if (!this.scrollContainer) return;
			if (anchor) {
				const newStride = newWidth + barGapFor(newWidth);
				// Map the anchor SVG-x from old scale to new scale,
				// preserving the visual position at viewportX.
				const newSvgX =
					20 +
					(anchor.svgX - 20) *
						(newStride / anchor.oldStride);
				this.scrollContainer.scrollLeft = Math.max(
					0,
					newSvgX - anchor.viewportX
				);
			} else {
				const maxScroll =
					this.scrollContainer.scrollWidth -
					this.scrollContainer.clientWidth;
				this.scrollContainer.scrollLeft =
					maxScroll * this.scrollRatio;
			}
		});
	}
}

// ─── Settings tab ───────────────────────────────────────────────────

class DaylioSettingTab extends PluginSettingTab {
	plugin: DaylioGraphPlugin;

	constructor(app: App, plugin: DaylioGraphPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h2", { text: "Daylio Mood Graph Settings" });

		// ── CSV file picker ────────────────────────────────────────────
		// Scan the vault for CSV files and populate a dropdown so the
		// user never has to type a path manually.
		const csvFiles = this.app.vault
			.getFiles()
			.filter((f) => f.extension === "csv")
			.sort((a, b) => a.path.localeCompare(b.path));

		const currentPath = this.plugin.settings.csvPath;

		new Setting(containerEl)
			.setName("CSV file path")
			.setDesc(
				csvFiles.length === 0
					? "No CSV files found in this vault. " +
					  "Add your Daylio export first, then reopen settings."
					: "Select the Daylio CSV export file from your vault."
			)
			.addDropdown((dropdown) => {
				dropdown.addOption("", "— choose a file —");

				for (const file of csvFiles) {
					dropdown.addOption(file.path, file.path);
				}

				// If the saved path is not among the discovered files
				// (e.g. the file was renamed or deleted), keep it in
				// the list so the user can see what was previously set.
				if (
					currentPath &&
					!csvFiles.some((f) => f.path === currentPath)
				) {
					dropdown.addOption(
						currentPath,
						`${currentPath} ⚠ not found`
					);
				}

				dropdown
					.setValue(currentPath)
					.onChange(async (value) => {
						this.plugin.settings.csvPath = value;
						await this.plugin.saveSettings();
					});
			});

		containerEl.createEl("h3", { text: "Mood Colours" });

		for (const mood of MOOD_LEVELS) {
			new Setting(containerEl)
				.setName(mood.charAt(0).toUpperCase() + mood.slice(1))
				.addColorPicker((picker) =>
					picker
						.setValue(this.plugin.settings.moodColors[mood])
						.onChange(async (value) => {
							this.plugin.settings.moodColors[mood] = value;
							await this.plugin.saveSettings();
						})
				);
		}

		new Setting(containerEl)
			.setName("Reset colours to defaults")
			.addButton((btn) =>
				btn.setButtonText("Reset").onClick(async () => {
					this.plugin.settings.moodColors = {
						...DEFAULT_MOOD_COLORS,
					};
					await this.plugin.saveSettings();
					this.display(); // re-render settings UI
				})
			);
	}
}

// ─── Plugin entry point ─────────────────────────────────────────────

export default class DaylioGraphPlugin extends Plugin {
	settings: DaylioGraphSettings = DEFAULT_SETTINGS;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.registerView(VIEW_TYPE_DAYLIO, (leaf) => {
			return new DaylioGraphView(leaf, this);
		});

		this.addRibbonIcon(DAYLIO_ICON_ID, "Open Daylio Mood Graph", () => {
			this.activateView();
		});

		this.addCommand({
			id: "open-daylio-mood-graph",
			name: "Open Daylio Mood Graph",
			callback: () => {
				this.activateView();
			},
		});

		this.addSettingTab(new DaylioSettingTab(this.app, this));
	}

	onunload(): void {
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_DAYLIO);
	}

	async loadSettings(): Promise<void> {
		const loaded = await this.loadData();
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			loaded as Partial<DaylioGraphSettings>
		);
		// Ensure every mood has a colour (in case new moods are added)
		for (const mood of MOOD_LEVELS) {
			if (!this.settings.moodColors[mood]) {
				this.settings.moodColors[mood] =
					DEFAULT_MOOD_COLORS[mood];
			}
		}
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	/** Open or focus the mood graph view. */
	async activateView(): Promise<void> {
		const { workspace } = this.app;

		let leaf = workspace.getLeavesOfType(VIEW_TYPE_DAYLIO)[0];
		if (!leaf) {
			const newLeaf = workspace.getRightLeaf(false);
			if (!newLeaf) return;
			await newLeaf.setViewState({
				type: VIEW_TYPE_DAYLIO,
				active: true,
			});
			leaf = newLeaf;
		}
		workspace.revealLeaf(leaf);
	}
}
