import { App, ItemView, Notice, TFile, WorkspaceLeaf } from "obsidian";
import log from "./log";
import {
	MOOD_LEVELS,
	VIEW_TYPE_DAYLIO,
	barGapFor,
	BAR_WIDTH_MIN,
	BAR_WIDTH_MAX,
	BAR_WIDTH_STEP,
	BAR_WIDTH_FINE_THRESHOLD,
	BAR_WIDTH_FINE_STEP,
	BAR_WIDTH_COARSE_STEP,
	type DayData,
	type VaultEvent,
	type HasDaylioSettings,
	DAYLIO_ICON_ID,
} from "./types";
import { parseDaylioCsv, groupByDay } from "./csv-parser";
import { scanVaultEvents } from "./vault-scanner";
import { buildGraphSvg } from "./graph-builder";

export class DaylioGraphView extends ItemView {
	private plugin: HasDaylioSettings & { app: App };
	private scrollContainer: HTMLElement | null = null;
	private scrollRatio = 1;
	private zoomSlider: HTMLInputElement | null = null;
	private zoomDebounceTimer: ReturnType<typeof setTimeout> | undefined;
	private cachedDays: DayData[] = [];
	private cachedVaultEvents: VaultEvent[] = [];

	constructor(leaf: WorkspaceLeaf, plugin: HasDaylioSettings & { app: App }) {
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
		return DAYLIO_ICON_ID
	}

	async onOpen(): Promise<void> {
		log("view opened");
		await this.renderGraph();
	}

	async onClose(): Promise<void> {
		log("view closed");
		clearTimeout(this.zoomDebounceTimer);
		this.containerEl.empty();
	}

	/** Open a vault file by path, with error notice on failure. */
	private openFile(filePath: string): void {
		log("opening file:", filePath);
		const target = this.app.vault.getAbstractFileByPath(filePath);
		if (target instanceof TFile) {
			this.app.workspace.getLeaf(false).openFile(target);
		} else {
			console.warn("[daylio] file not found in vault:", filePath);
			new Notice(`Could not find note: ${filePath}`);
		}
	}

	/** Full re-render — called on open and when settings change. */
	async renderGraph(): Promise<void> {
		log("renderGraph: starting full render");
		const container = this.containerEl.children[1] as HTMLElement;

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
			log("renderGraph: no CSV path configured");
			container.createEl("p", {
				text: "No CSV path configured. Open the Daylio Mood Graph settings to set the path to your Daylio export.",
				cls: "daylio-graph-notice",
			});
			return;
		}
		log("renderGraph: CSV path is", csvPath);

		const csvFile = this.app.vault.getAbstractFileByPath(csvPath);
		if (!(csvFile instanceof TFile)) {
			log("renderGraph: CSV file not found at path:", csvPath);
			container.createEl("p", {
				text: `CSV file not found at "${csvPath}". Check the path in settings.`,
				cls: "daylio-graph-notice",
			});
			return;
		}

		let csvText: string;
		try {
			csvText = await this.app.vault.read(csvFile);
			log("renderGraph: CSV read successfully,", csvText.length, "chars");
		} catch (error) {
			console.warn("[daylio] renderGraph: failed to read CSV:", error);
			container.createEl("p", {
				text: "Failed to read the CSV file.",
				cls: "daylio-graph-notice",
			});
			return;
		}

		const allEntries = parseDaylioCsv(csvText);
		if (allEntries.length === 0) {
			log("renderGraph: no valid mood entries found in CSV");
			container.createEl("p", {
				text: "No valid mood entries found in the CSV.",
				cls: "daylio-graph-notice",
			});
			return;
		}

		// ── Zoom toolbar ────────────────────────────────────────
		const toolbar = container.createDiv({ cls: "daylio-graph-toolbar" });
		toolbar.createSpan({ text: "Zoom", cls: "daylio-zoom-label" });

		const stepZoom = (delta: number): void => {
			const newWidth = Math.max(
				BAR_WIDTH_MIN,
				Math.min(BAR_WIDTH_MAX, this.plugin.settings.barWidth + delta),
			);
			if (newWidth === this.plugin.settings.barWidth) return;
			slider.value = String(newWidth);
			if (this.scrollContainer) {
				const viewportX = this.scrollContainer.clientWidth / 2;
				const svgX = this.scrollContainer.scrollLeft + viewportX;
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
		minusBtn.addEventListener("click", () => stepZoom(-BAR_WIDTH_STEP));

		const slider = toolbar.createEl("input") as HTMLInputElement;
		slider.type = "range";
		slider.min = String(BAR_WIDTH_MIN);
		slider.max = String(BAR_WIDTH_MAX);
		slider.step = String(BAR_WIDTH_STEP);
		slider.value = String(this.plugin.settings.barWidth);
		slider.addClass("daylio-zoom-slider");
		this.zoomSlider = slider;

		slider.addEventListener("input", () => {
			const newWidth = parseFloat(slider.value);
			if (
				newWidth === this.plugin.settings.barWidth ||
				!this.scrollContainer
			) return;
			const viewportX = this.scrollContainer.clientWidth / 2;
			const svgX = this.scrollContainer.scrollLeft + viewportX;
			const oldBW = this.plugin.settings.barWidth;
			this.quickRedraw(newWidth, {
				svgX,
				viewportX,
				oldStride: oldBW + barGapFor(oldBW),
			});
		});

		slider.addEventListener("change", async () => {
			await this.plugin.saveSettings();
		});

		const plusBtn = toolbar.createEl("button", {
			text: "+",
			cls: "daylio-zoom-btn",
		});
		plusBtn.setAttribute("aria-label", "Zoom in");
		plusBtn.addEventListener("click", () => stepZoom(BAR_WIDTH_STEP));

		// ── Labels toggle ────────────────────────────────────────
		const labelsLabel = toolbar.createEl("label", {
			cls: "daylio-labels-toggle",
		});
		const labelsCheck = labelsLabel.createEl("input") as HTMLInputElement;
		labelsCheck.type = "checkbox";
		labelsCheck.checked = this.plugin.settings.showEventLabels;
		labelsLabel.createSpan({ text: "Labels" });
		labelsCheck.addEventListener("change", async () => {
			this.plugin.settings.showEventLabels = labelsCheck.checked;
			this.quickRedraw(this.plugin.settings.barWidth);
			await this.plugin.saveSettings();
		});

		// ── Refresh button ───────────────────────────────────────
		const refreshBtn = toolbar.createEl("button", {
			text: "↺",
			cls: "daylio-zoom-btn",
		});
		refreshBtn.setAttribute("aria-label", "Refresh graph");
		refreshBtn.addEventListener("click", () => {
			void this.renderGraph();
		});

		// ── Collect vault events + cache parsed data ────────────
		this.cachedVaultEvents = scanVaultEvents(
			this.app,
			this.plugin.settings.eventScanDir || undefined,
		);
		this.cachedDays = groupByDay(allEntries);
		log(
			"renderGraph: cached", this.cachedDays.length, "days and",
			this.cachedVaultEvents.length, "vault events",
		);

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

		this.setupDragPan(this.scrollContainer);

		this.scrollContainer.addEventListener(
			"wheel",
			(evt) => {
				evt.preventDefault();
				if (evt.ctrlKey) {
					const step =
						this.plugin.settings.barWidth <= BAR_WIDTH_FINE_THRESHOLD
							? BAR_WIDTH_FINE_STEP
							: BAR_WIDTH_COARSE_STEP;
					const delta = evt.deltaY < 0 ? step : -step;
					const newWidth = Math.max(
						BAR_WIDTH_MIN,
						Math.min(
							BAR_WIDTH_MAX,
							this.plugin.settings.barWidth + delta,
						),
					);
					if (newWidth !== this.plugin.settings.barWidth) {
						const rect =
							this.scrollContainer!.getBoundingClientRect();
						const viewportX = evt.clientX - rect.left;
						const svgX =
							this.scrollContainer!.scrollLeft + viewportX;
						const oldBW = this.plugin.settings.barWidth;
						this.quickRedraw(newWidth, {
							svgX,
							viewportX,
							oldStride: oldBW + barGapFor(oldBW),
						});
						clearTimeout(this.zoomDebounceTimer);
						this.zoomDebounceTimer = setTimeout(async () => {
							await this.plugin.saveSettings();
						}, 300);
					}
				} else {
					this.scrollContainer!.scrollLeft +=
						evt.deltaX + evt.deltaY;
				}
			},
			{ passive: false },
		);

		this.scrollContainer.appendChild(this.buildSvg(this.plugin.settings.barWidth));

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

	/**
	 * Attach drag-to-pan behaviour to the horizontal scroll container.
	 *
	 * Left-mouse-drag translates to horizontal scroll.  A small drag
	 * distance threshold (> 4 px) gates whether the pointer-up is
	 * treated as a click so that vault-entry click handlers are not
	 * triggered when the user releases the mouse after panning.
	 *
	 * Cursor changes:
	 *   default          → grab   (via CSS on .daylio-graph-scroll)
	 *   hovering entry   → pointer (via CSS on .daylio-entry-group)
	 *   while panning    → grabbing (via class on document.body, !important
	 *                               so it wins over child pointer cursors)
	 */
	private setupDragPan(scrollEl: HTMLElement): void {
		let isDragging = false;
		let startX = 0;
		let startScrollLeft = 0;
		let totalDragPx = 0;

		this.registerDomEvent(scrollEl, "mousedown", (evt: MouseEvent) => {
			if (evt.button !== 0) return;
			isDragging = true;
			totalDragPx = 0;
			startX = evt.clientX;
			startScrollLeft = scrollEl.scrollLeft;
			document.body.classList.add("daylio-is-panning");
			// Prevent text selection while dragging.
			evt.preventDefault();
		});

		this.registerDomEvent(document, "mousemove", (evt: MouseEvent) => {
			if (!isDragging) return;
			// Dragging right (positive clientX delta) scrolls left, and
			// vice versa — matches the feel of moving content under the hand.
			const delta = startX - evt.clientX;
			totalDragPx = Math.abs(delta);
			scrollEl.scrollLeft = startScrollLeft + delta;
		});

		this.registerDomEvent(document, "mouseup", () => {
			if (!isDragging) return;
			isDragging = false;
			document.body.classList.remove("daylio-is-panning");
		});

		// Suppress clicks that were actually the end of a pan gesture.
		// Runs in capture phase so it intercepts before child handlers
		// (day overlays, event labels) see the event.
		this.registerDomEvent(
			scrollEl,
			"click",
			(evt: MouseEvent) => {
				if (totalDragPx > 4) {
					evt.stopPropagation();
					evt.preventDefault();
					totalDragPx = 0;
				}
			},
			{ capture: true },
		);
	}

	/** Thin wrapper around the pure graph builder, passing context. */
	private buildSvg(barWidth: number): SVGSVGElement {
		return buildGraphSvg(barWidth, this.cachedDays, this.cachedVaultEvents, {
			moodColors: this.plugin.settings.moodColors,
			openFile: (fp) => this.openFile(fp),
			showEventLabels: this.plugin.settings.showEventLabels,
		});
	}

	/**
	 * Replace SVG without full renderGraph() (no CSV read, no toolbar rebuild).
	 * Anchor keeps the day column under the cursor pinned.
	 */
	private quickRedraw(
		newWidth: number,
		anchor?: {
			svgX: number;
			viewportX: number;
			oldStride: number;
		},
	): void {
		if (!this.scrollContainer || this.cachedDays.length === 0) return;
		log(
			"quickRedraw:", this.plugin.settings.barWidth, "→", newWidth,
			anchor ? "(cursor-anchored)" : "(ratio-based scroll)",
		);
		this.plugin.settings.barWidth = newWidth;
		if (this.zoomSlider) {
			this.zoomSlider.value = String(newWidth);
		}
		this.scrollContainer.empty();
		this.scrollContainer.appendChild(this.buildSvg(newWidth));

		requestAnimationFrame(() => {
			if (!this.scrollContainer) return;
			if (anchor) {
				const newStride = newWidth + barGapFor(newWidth);
				const newSvgX =
					20 +
					(anchor.svgX - 20) *
						(newStride / anchor.oldStride);
				this.scrollContainer.scrollLeft = Math.max(
					0,
					newSvgX - anchor.viewportX,
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
