import {
	App,
	ItemView,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
	WorkspaceLeaf,
} from "obsidian";

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
	monthsToShow: number;
}

const DEFAULT_SETTINGS: DaylioGraphSettings = {
	csvPath: "",
	moodColors: { ...DEFAULT_MOOD_COLORS },
	monthsToShow: 3,
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

class DaylioGraphView extends ItemView {
	private plugin: DaylioGraphPlugin;
	private scrollContainer: HTMLElement | null = null;

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
		this.containerEl.empty();
	}

	/** Full re-render — called on open and when settings change. */
	async renderGraph(): Promise<void> {
		const container = this.containerEl.children[1] as HTMLElement;
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

		// ── Filter to the configured time window ────────────────
		const allDays = groupByDay(allEntries);
		const cutoffDate = new Date();
		cutoffDate.setMonth(
			cutoffDate.getMonth() - this.plugin.settings.monthsToShow
		);
		const cutoffStr = cutoffDate.toISOString().slice(0, 10);
		const days = allDays.filter((d) => d.date >= cutoffStr);

		if (days.length === 0) {
			container.createEl("p", {
				text: "No mood entries in the selected time range.",
				cls: "daylio-graph-notice",
			});
			return;
		}

		// ── Collect vault events ────────────────────────────────
		const vaultEvents = scanVaultEvents(this.app);
		const eventsByDate = new Map<string, VaultEvent>();
		for (const event of vaultEvents) {
			eventsByDate.set(event.date, event);
		}

		// ── Time range selector ─────────────────────────────────
		const toolbar = container.createDiv({ cls: "daylio-graph-toolbar" });
		for (const months of [1, 2, 3, 6, 12]) {
			const button = toolbar.createEl("button", {
				text: months === 12 ? "1 Year" : `${months} Mo`,
				cls: "daylio-graph-range-btn",
			});
			if (months === this.plugin.settings.monthsToShow) {
				button.addClass("daylio-graph-range-active");
			}
			button.addEventListener("click", async () => {
				this.plugin.settings.monthsToShow = months;
				await this.plugin.saveSettings();
				await this.renderGraph();
			});
		}

		// ── Mood legend ─────────────────────────────────────────
		const legend = container.createDiv({ cls: "daylio-graph-legend" });
		for (const mood of [...MOOD_LEVELS].reverse()) {
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

		const BAR_WIDTH = 14;
		const BAR_GAP = 3;
		const GRAPH_HEIGHT = 220;
		const DATE_HEADER_HEIGHT = 50;
		const EVENT_LABEL_HEIGHT = 60;
		const TOTAL_HEIGHT =
			GRAPH_HEIGHT + DATE_HEADER_HEIGHT + EVENT_LABEL_HEIGHT;

		const graphWidth =
			days.length * (BAR_WIDTH + BAR_GAP) - BAR_GAP + 40;

		const svg = document.createElementNS(
			"http://www.w3.org/2000/svg",
			"svg"
		);
		svg.setAttribute("width", String(graphWidth));
		svg.setAttribute("height", String(TOTAL_HEIGHT));
		svg.setAttribute("viewBox", `0 0 ${graphWidth} ${TOTAL_HEIGHT}`);
		svg.addClass("daylio-graph-svg");

		// ── Month separator lines and labels ────────────────────
		let currentMonth = "";
		for (let i = 0; i < days.length; i++) {
			const day = days[i];
			if (!day) continue;
			const monthStr = day.date.slice(0, 7); // "YYYY-MM"
			if (monthStr !== currentMonth) {
				currentMonth = monthStr;
				const x = 20 + i * (BAR_WIDTH + BAR_GAP);

				// Vertical separator line
				const line = document.createElementNS(
					"http://www.w3.org/2000/svg",
					"line"
				);
				line.setAttribute("x1", String(x - 2));
				line.setAttribute("y1", String(EVENT_LABEL_HEIGHT));
				line.setAttribute("x2", String(x - 2));
				line.setAttribute(
					"y2",
					String(EVENT_LABEL_HEIGHT + DATE_HEADER_HEIGHT + GRAPH_HEIGHT)
				);
				line.setAttribute("class", "daylio-month-line");
				svg.appendChild(line);

				// Month label
				const monthLabel = document.createElementNS(
					"http://www.w3.org/2000/svg",
					"text"
				);
				const monthDate = new Date(day.date + "T00:00:00");
				const monthName = monthDate.toLocaleString("default", {
					month: "short",
				});
				monthLabel.textContent = `${monthName} ${monthDate.getFullYear()}`;
				monthLabel.setAttribute("x", String(x + 2));
				monthLabel.setAttribute(
					"y",
					String(EVENT_LABEL_HEIGHT + 12)
				);
				monthLabel.setAttribute("class", "daylio-month-label");
				svg.appendChild(monthLabel);
			}
		}

		// ── Draw bars and date ticks ────────────────────────────
		for (let i = 0; i < days.length; i++) {
			const day = days[i];
			if (!day) continue;
			const x = 20 + i * (BAR_WIDTH + BAR_GAP);
			const entryCount = day.entries.length;
			const segmentHeight = GRAPH_HEIGHT / Math.max(entryCount, 1);

			for (let j = 0; j < entryCount; j++) {
				const entry = day.entries[j];
				if (!entry) continue;
				const segY =
					EVENT_LABEL_HEIGHT +
					DATE_HEADER_HEIGHT +
					GRAPH_HEIGHT -
					(j + 1) * segmentHeight;
				const rect = document.createElementNS(
					"http://www.w3.org/2000/svg",
					"rect"
				);
				rect.setAttribute("x", String(x));
				rect.setAttribute("y", String(segY));
				rect.setAttribute("width", String(BAR_WIDTH));
				rect.setAttribute("height", String(segmentHeight));
				rect.setAttribute("rx", "2");
				rect.setAttribute(
					"fill",
					this.plugin.settings.moodColors[entry.mood]
				);

				// Tooltip
				const title = document.createElementNS(
					"http://www.w3.org/2000/svg",
					"title"
				);
				title.textContent = `${day.date} ${entry.time} — ${entry.mood}`;
				rect.appendChild(title);
				svg.appendChild(rect);
			}

			// Date tick — show day-of-month for every Nth day
			const dayOfMonth = parseInt(day.date.slice(8, 10), 10);
			const showTick =
				days.length < 60
					? true
					: days.length < 120
						? dayOfMonth % 2 === 1
						: dayOfMonth % 5 === 1 || dayOfMonth === 1;

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
					String(
						EVENT_LABEL_HEIGHT + DATE_HEADER_HEIGHT - 4
					)
				);
				tick.setAttribute("class", "daylio-date-tick");
				svg.appendChild(tick);
			}

			// ── Event label (if any) ────────────────────────────
			const event = eventsByDate.get(day.date);
			if (event) {
				// Vertical connector line
				const connector = document.createElementNS(
					"http://www.w3.org/2000/svg",
					"line"
				);
				connector.setAttribute(
					"x1",
					String(x + BAR_WIDTH / 2)
				);
				connector.setAttribute(
					"y1",
					String(EVENT_LABEL_HEIGHT - 2)
				);
				connector.setAttribute(
					"x2",
					String(x + BAR_WIDTH / 2)
				);
				connector.setAttribute(
					"y2",
					String(EVENT_LABEL_HEIGHT + DATE_HEADER_HEIGHT)
				);
				connector.setAttribute("class", "daylio-event-connector");
				svg.appendChild(connector);

				// The label itself — rendered as a <foreignObject>
				// so we can make it a clickable, text-wrapped element.
				const fo = document.createElementNS(
					"http://www.w3.org/2000/svg",
					"foreignObject"
				);
				const labelWidth = 100;
				fo.setAttribute(
					"x",
					String(x + BAR_WIDTH / 2 - labelWidth / 2)
				);
				fo.setAttribute("y", "2");
				fo.setAttribute("width", String(labelWidth));
				fo.setAttribute(
					"height",
					String(EVENT_LABEL_HEIGHT - 4)
				);

				const labelDiv = document.createElement("div");
				labelDiv.className = "daylio-event-label";
				labelDiv.textContent = event.label;
				labelDiv.title = `${event.label}\n${event.date}\nClick to open note`;

				// Navigate to the note on click
				const filePath = event.filePath;
				labelDiv.addEventListener("click", (evt) => {
					evt.preventDefault();
					evt.stopPropagation();
					const targetFile =
						this.app.vault.getAbstractFileByPath(filePath);
					if (targetFile instanceof TFile) {
						this.app.workspace.getLeaf(false).openFile(
							targetFile
						);
					} else {
						new Notice(
							`Could not find note: ${filePath}`
						);
					}
				});

				fo.appendChild(labelDiv);
				svg.appendChild(fo);

				// Small diamond marker at the connector start
				const diamond = document.createElementNS(
					"http://www.w3.org/2000/svg",
					"polygon"
				);
				const cx = x + BAR_WIDTH / 2;
				const cy = EVENT_LABEL_HEIGHT - 2;
				diamond.setAttribute(
					"points",
					`${cx},${cy - 4} ${cx + 4},${cy} ${cx},${cy + 4} ${cx - 4},${cy}`
				);
				diamond.setAttribute("class", "daylio-event-diamond");
				svg.appendChild(diamond);
			}
		}

		this.scrollContainer.appendChild(svg);

		// Scroll to the end (most recent) by default
		requestAnimationFrame(() => {
			if (this.scrollContainer) {
				this.scrollContainer.scrollLeft =
					this.scrollContainer.scrollWidth;
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

		new Setting(containerEl)
			.setName("CSV file path")
			.setDesc(
				"Path to the Daylio CSV export inside your vault " +
				"(e.g. \"attachments/daylio_export.csv\")."
			)
			.addText((text) =>
				text
					.setPlaceholder("path/to/daylio_export.csv")
					.setValue(this.plugin.settings.csvPath)
					.onChange(async (value) => {
						this.plugin.settings.csvPath = value.trim();
						await this.plugin.saveSettings();
					})
			);

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

		this.addRibbonIcon("bar-chart-2", "Open Daylio Mood Graph", () => {
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
