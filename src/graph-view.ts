import { App, ItemView, Notice, TFile, WorkspaceLeaf } from "obsidian";
import {
	MOOD_LEVELS,
	VIEW_TYPE_DAYLIO,
	BAR_WIDTH_MIN,
	BAR_WIDTH_MAX,
	BAR_WIDTH_STEP,
	BAR_WIDTH_FINE_THRESHOLD,
	BAR_WIDTH_FINE_STEP,
	BAR_WIDTH_COARSE_STEP,
	MouseButton,
	type DayData,
	type VaultEvent,
	type HasDaylioSettings,
	DAYLIO_ICON_ID,
} from "./types";
import { barGapFor, computeStickyLabelPosition } from "./utils";
import { parseDaylioCsv, groupByDay } from "./csv-parser";
import { scanVaultEvents } from "./vault-scanner";
import {
	buildGraphSvg,
	type RangeTooltipData,
} from "./graph-builder";
import {
	computeAnchoredScroll,
	computeIntrinsicWidth,
} from "./scroll-math";

/** Horizontal drag distance (px) above which a mouseup is treated as a pan
 *  gesture rather than a click, suppressing child click handlers. */
const DRAG_CLICK_THRESHOLD_PX = 4;
/** Debounce delay (ms) before persisting barWidth to disk after a wheel zoom.
 *  Batches rapid scroll events into a single saveSettings() call. */
const SAVE_DEBOUNCE_MS = 300;

export class DaylioGraphView extends ItemView {
	private plugin: HasDaylioSettings & { app: App };
	private scrollContainer: HTMLElement | null = null;
	private tooltipEl: HTMLElement | null = null;
	private scrollRatio = 1;
	private zoomSlider: HTMLInputElement | null = null;
	private zoomDebounceTimer: ReturnType<typeof setTimeout> | undefined;
	private cachedDays: DayData[] = [];
	private cachedVaultEvents: VaultEvent[] = [];
	/** Pending requestAnimationFrame id for scroll-position restore after a
	 *  quickRedraw.  Cancelled before each new quickRedraw so that only the
	 *  most-recent anchor calculation takes effect, preventing stale RAF
	 *  callbacks from snapping the scroll to wrong positions during rapid zoom. */
	private scrollRafId: number | null = null;
	/** Pending requestAnimationFrame id for sticky range label updates. */
	private stickyRafId: number | null = null;
	/** The scroll-left value that the pending RAF will apply.  Set
	 *  synchronously by quickRedraw so that a subsequent wheel event
	 *  (arriving before the RAF fires) reads the correct logical scroll
	 *  position rather than the stale 0 left by scrollContainer.empty(). */
	private intendedScrollLeft: number | null = null;
	/** Left margin on the SVG element, used to achieve "negative scroll"
	 *  when the cursor-anchored position would require scrollLeft < 0.
	 *  Set synchronously in quickRedraw; persists until the next redraw. */
	private intendedMarginLeft = 0;
	/** Incremented at the start of every renderGraph() call.  Any suspended
	 *  render that finds a newer generation has started aborts without
	 *  writing to the DOM, preventing duplicate scroll containers (and the
	 *  duplicate wheel listeners they carry). */
	private renderGeneration = 0;

	constructor(leaf: WorkspaceLeaf, plugin: HasDaylioSettings & { app: App }) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_DAYLIO;
	}

	getDisplayText(): string {
		return "Daylio mood graph";
	}

	getIcon(): string {
		return DAYLIO_ICON_ID;
	}

	async onOpen(): Promise<void> {
		await this.renderGraph();
	}

	onClose(): Promise<void> {
		clearTimeout(this.zoomDebounceTimer);
		if (this.stickyRafId !== null) {
			cancelAnimationFrame(this.stickyRafId);
		}
		this.containerEl.empty();
		return Promise.resolve();
	}

	/** Open a vault file by path, with error notice on failure. */
	private openFile(filePath: string): void {
		const target = this.app.vault.getAbstractFileByPath(filePath);
		if (target instanceof TFile) {
			void this.app.workspace.getLeaf(false).openFile(target);
		} else {
			console.warn("[daylio] file not found in vault:", filePath);
			new Notice(`Could not find note: ${filePath}`);
		}
	}

	/** Full re-render — called on open and when settings change. */
	async renderGraph(): Promise<void> {
		const generation = ++this.renderGeneration;
		// Reset margin state — a full re-render starts with a clean SVG
		// that has no margin-left offset.
		this.intendedMarginLeft = 0;
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

		// ── Floating Rich Tooltip ───────────────────────────────
		this.tooltipEl = container.createDiv({ cls: "daylio-tooltip" });
		this.tooltipEl.style.display = "none";

		// ── Load CSV ────────────────────────────────────────────
		const csvPath = this.plugin.settings.csvPath;
		if (!csvPath) {
			container.createEl("p", {
				text: "No CSV path configured. Open the Daylio mood graph settings to set the path to your Daylio export.",
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
		} catch (error) {
			console.warn("[daylio] renderGraph: failed to read CSV:", error);
			container.createEl("p", {
				text: "Failed to read the CSV file.",
				cls: "daylio-graph-notice",
			});
			return;
		}

		// A newer renderGraph() call started while we were waiting for the
		// vault read.  Bail out without touching the DOM so only the latest
		// render wins and we never end up with duplicate scroll containers
		// (and their duplicate wheel listeners).
		if (generation !== this.renderGeneration) {
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

		// ── Collect vault events + cache parsed data ────────────
		this.cachedVaultEvents = scanVaultEvents(
			this.app,
			this.plugin.settings.eventScanDir || undefined,
		);
		this.cachedDays = groupByDay(allEntries);

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
			this.quickRedraw(newWidth, this.getCenterAnchor());
			void this.plugin.saveSettings();
		};

		const minusBtn = toolbar.createEl("button", {
			text: "−",
			cls: "daylio-zoom-btn",
		});
		minusBtn.setAttribute("aria-label", "Zoom out");
		minusBtn.addEventListener("click", () => stepZoom(-BAR_WIDTH_STEP));

		const slider = toolbar.createEl("input");
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
			this.quickRedraw(newWidth, this.getCenterAnchor());
		});

		slider.addEventListener("change", () => {
			void this.plugin.saveSettings();
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
		const labelsCheck = labelsLabel.createEl("input");
		labelsCheck.type = "checkbox";
		labelsCheck.checked = this.plugin.settings.showEventLabels;
		labelsLabel.createSpan({ text: "Labels" });
		labelsCheck.addEventListener("change", () => {
			this.plugin.settings.showEventLabels = labelsCheck.checked;
			// Use anchor-based scroll preservation: only vertical content
			// changes (label cards below the graph), so we keep the
			// horizontal position exactly where it was.
			this.quickRedraw(this.plugin.settings.barWidth, this.getCenterAnchor());
			void this.plugin.saveSettings();
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

		// ── Version label (right-aligned) ───────────────────────
		toolbar.createSpan({
			text: `v${this.plugin.manifest.version}`,
			cls: "daylio-version-label",
		});

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

		// Track whether the right mouse button is currently held so the
		// wheel handler can use it as a zoom modifier (right-hold + scroll).
		let rightButtonHeld = false;

		this.scrollContainer.addEventListener("mousedown", (evt) => {
			if (evt.button === MouseButton.Secondary) rightButtonHeld = true;
		});
		// Release on mouseup anywhere — the pointer may have drifted off
		// the scroll container while held.  Use registerDomEvent so the
		// listener is removed when the view closes (not a bare document
		// listener that accumulates across renderGraph() calls).
		this.registerDomEvent(document, "mouseup", (evt: MouseEvent) => {
			if (evt.button === MouseButton.Secondary) rightButtonHeld = false;
		});
		// Suppress the context menu when right-button was used for zooming.
		// Only fires when the button is released without having scrolled, so
		// normal (non-scrolling) right-clicks still work outside this element.
		this.scrollContainer.addEventListener("contextmenu", (evt) => {
			if (rightButtonHeld) evt.preventDefault();
		});

		this.scrollContainer.addEventListener(
			"wheel",
			(evt) => this.handleWheel(evt, rightButtonHeld),
			{ passive: false },
		);

		this.scrollContainer.addEventListener(
			"scroll",
			() => {
				this.scheduleUpdateStickyRangeLabels();
			},
			{ passive: true },
		);

		this.scrollContainer.appendChild(this.buildSvg(this.plugin.settings.barWidth));

		requestAnimationFrame(() => {
			if (this.scrollContainer) {
				const maxScroll =
					this.scrollContainer.scrollWidth -
					this.scrollContainer.clientWidth;
				this.scrollContainer.scrollLeft =
					maxScroll * this.scrollRatio;
				this.updateStickyRangeLabels();
			}
		});
	}

	/**
	 * Handle wheel events on the scroll container.
	 *
	 * When Ctrl or right-mouse-button is held, vertical wheel scrolling
	 * zooms the graph anchored at the mouse cursor. Otherwise, wheel
	 * scrolling scrolls horizontally.
	 */
	private handleWheel(evt: WheelEvent, rightButtonHeld: boolean): void {
		// Stop all wheel events here: prevents Obsidian's own
		// Ctrl+wheel handler (which may be capturing or document-
		// level) from also firing and producing a double-tick.
		evt.preventDefault();
		evt.stopPropagation();
		evt.stopImmediatePropagation();

		if ((evt.ctrlKey || rightButtonHeld) && evt.deltaY !== 0) {
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
				const currentScrollLeft =
					this.intendedScrollLeft ??
					this.scrollContainer!.scrollLeft;
				const svgX =
					currentScrollLeft + viewportX -
					this.intendedMarginLeft;
				const oldBW = this.plugin.settings.barWidth;
				this.quickRedraw(newWidth, {
					svgX,
					viewportX,
					oldStride: oldBW + barGapFor(oldBW),
				});
				clearTimeout(this.zoomDebounceTimer);
				this.zoomDebounceTimer = setTimeout(() => {
					void this.plugin.saveSettings();
				}, SAVE_DEBOUNCE_MS);
			}
		} else {
			this.scrollContainer!.scrollLeft +=
				evt.deltaX + evt.deltaY;
		}
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
			if (evt.button !== MouseButton.Main) return;
			isDragging = true;
			totalDragPx = 0;
			startX = evt.clientX;
			startScrollLeft = scrollEl.scrollLeft;
			this.intendedScrollLeft = null;
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
			this.intendedScrollLeft = null;
			this.updateStickyRangeLabels();
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
				if (totalDragPx > DRAG_CLICK_THRESHOLD_PX) {
					evt.stopPropagation();
					evt.preventDefault();
					totalDragPx = 0;
				}
			},
			{ capture: true },
		);
	}

	/** Thin wrapper around the pure graph builder, passing context. */
	private buildSvg(barWidth: number, minWidth?: number): SVGSVGElement {
		return buildGraphSvg(barWidth, this.cachedDays, this.cachedVaultEvents, {
			moodColors: this.plugin.settings.moodColors,
			openFile: (fp) => this.openFile(fp),
			showEventLabels: this.plugin.settings.showEventLabels,
			minWidth,
			onEventHover: (evt, data) => this.showTooltip(evt, data),
			onEventMove: (evt) => this.positionTooltip(evt),
			onEventLeave: () => this.hideTooltip(),
		});
	}

	/** Schedule an update of sticky range labels via RAF. */
	private scheduleUpdateStickyRangeLabels(): void {
		if (this.stickyRafId !== null) return;
		this.stickyRafId = requestAnimationFrame(() => {
			this.stickyRafId = null;
			this.updateStickyRangeLabels();
		});
	}

	/**
	 * Pins the label text of partially-visible range events to the visible
	 * left edge of the viewport when their beginning is scrolled out of frame.
	 */
	private updateStickyRangeLabels(): void {
		if (!this.scrollContainer) return;
		const visibleLeft =
			this.scrollContainer.scrollLeft - this.intendedMarginLeft;
		const rangeFos =
			this.scrollContainer.querySelectorAll<SVGForeignObjectElement>(
				".daylio-range-fo",
			);

		for (let i = 0; i < rangeFos.length; i++) {
			const fo = rangeFos[i];
			if (!fo) continue;
			const x1 = parseFloat(fo.getAttribute("data-x1") ?? "0");
			const x2 = parseFloat(fo.getAttribute("data-x2") ?? "0");
			const cardX = parseFloat(fo.getAttribute("data-card-x") ?? String(x1));
			const cardW = parseFloat(fo.getAttribute("data-card-w") ?? "0");
			const pillW = parseFloat(fo.getAttribute("data-pill-w") ?? "0");
			const isCallout = fo.getAttribute("data-is-callout") === "true";

			const result = computeStickyLabelPosition({
				x1,
				x2,
				cardX,
				cardW,
				pillW,
				isCallout,
				visibleLeft,
			});

			fo.setAttribute("x", String(result.x));
			fo.setAttribute("width", String(result.width));
		}
	}

	/** Display rich tooltip with event details and mood proportion bar. */
	private showTooltip(event: MouseEvent, data: RangeTooltipData): void {
		if (!this.tooltipEl || !this.scrollContainer) return;
		this.tooltipEl.empty();

		// Title
		const titleEl = this.tooltipEl.createDiv({ cls: "daylio-tooltip-title" });
		titleEl.textContent = data.label;

		// Dates
		const datesEl = this.tooltipEl.createDiv({ cls: "daylio-tooltip-dates" });
		if (data.isRange && data.endDate) {
			const daysText = `${data.moodSummary.totalDays} day${data.moodSummary.totalDays === 1 ? "" : "s"}`;
			datesEl.textContent = `${data.date} → ${data.endDate} (${daysText})`;
		} else {
			datesEl.textContent = data.date;
		}

		// For range events: Mood Proportion Bar Graph
		if (data.isRange && data.moodSummary.totalEntries > 0) {
			const barEl = this.tooltipEl.createDiv({ cls: "daylio-tooltip-bar" });
			for (const prop of data.moodSummary.proportions) {
				if (prop.count === 0) continue;
				const seg = barEl.createDiv({ cls: "daylio-tooltip-bar-segment" });
				seg.style.width = `${prop.percentage.toFixed(1)}%`;
				seg.style.backgroundColor = this.plugin.settings.moodColors[prop.mood];
			}

			const legendEl = this.tooltipEl.createDiv({ cls: "daylio-tooltip-legend" });
			for (const prop of data.moodSummary.proportions) {
				if (prop.count === 0) continue;
				const item = legendEl.createSpan({ cls: "daylio-tooltip-legend-item" });
				const swatch = item.createSpan({ cls: "daylio-tooltip-swatch" });
				swatch.style.backgroundColor = this.plugin.settings.moodColors[prop.mood];
				item.appendText(`${prop.count} ${prop.mood}`);
			}
		} else if (data.isRange && data.moodSummary.totalEntries === 0) {
			const emptyEl = this.tooltipEl.createDiv({ cls: "daylio-tooltip-empty" });
			emptyEl.textContent = "No mood entries in this range";
		}


		this.tooltipEl.style.display = "block";
		this.positionTooltip(event);
	}

	/** Position the floating tooltip relative to the cursor inside the root container. */
	private positionTooltip(event: MouseEvent): void {
		if (!this.tooltipEl || !this.scrollContainer) return;
		const rootRect =
			this.scrollContainer.parentElement?.getBoundingClientRect() ??
			this.scrollContainer.getBoundingClientRect();
		const tooltipWidth = this.tooltipEl.offsetWidth || 200;
		const tooltipHeight = this.tooltipEl.offsetHeight || 80;

		let left = event.clientX - rootRect.left + 12;
		let top = event.clientY - rootRect.top + 12;

		if (left + tooltipWidth > rootRect.width - 12) {
			left = event.clientX - rootRect.left - tooltipWidth - 12;
		}
		if (top + tooltipHeight > rootRect.height - 12) {
			top = event.clientY - rootRect.top - tooltipHeight - 12;
		}

		this.tooltipEl.style.left = `${Math.max(8, left)}px`;
		this.tooltipEl.style.top = `${Math.max(8, top)}px`;
	}

	/** Hide the floating tooltip. */
	private hideTooltip(): void {
		if (this.tooltipEl) {
			this.tooltipEl.style.display = "none";
		}
	}

	/**
	 * Compute anchor parameters centered at the visible viewport midpoint.
	 * Returns undefined if no scroll container is active.
	 */
	private getCenterAnchor(): { svgX: number; viewportX: number; oldStride: number } | undefined {
		if (!this.scrollContainer) return undefined;
		const viewportX = this.scrollContainer.clientWidth / 2;
		const scrollLeft = this.intendedScrollLeft ?? this.scrollContainer.scrollLeft;
		const svgX = scrollLeft + viewportX - this.intendedMarginLeft;
		const oldBW = this.plugin.settings.barWidth;
		return {
			svgX,
			viewportX,
			oldStride: oldBW + barGapFor(oldBW),
		};
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
		this.plugin.settings.barWidth = newWidth;
		if (this.zoomSlider) {
			this.zoomSlider.value = String(newWidth);
		}

		const newStride = newWidth + barGapFor(newWidth);
		const intrinsicSvgWidth = computeIntrinsicWidth(
			this.cachedDays.length,
			newWidth,
		);
		const containerWidth = this.scrollContainer.clientWidth;

		let neededSvgWidth: number;
		if (anchor) {
			// Delegate the scroll-position math to the pure function so it
			// can be verified in unit tests.  The result includes the margin
			// needed when rawScrollLeft would be negative (i.e. the target
			// day sits right of where scrollLeft = 0 would place it).
			const result = computeAnchoredScroll(
				anchor,
				newStride,
				intrinsicSvgWidth,
				containerWidth,
			);
			neededSvgWidth = result.svgWidth;
			this.intendedScrollLeft = result.scrollLeft;
			this.intendedMarginLeft = result.marginLeft;
		} else {
			// Fallback: preserve absolute scroll position (clamped to fit).
			const savedScrollLeft = this.scrollContainer.scrollLeft;
			this.intendedMarginLeft = 0;
			neededSvgWidth = Math.max(
				intrinsicSvgWidth,
				savedScrollLeft + containerWidth + 1,
			);
			this.intendedScrollLeft = savedScrollLeft;
		}

		this.scrollContainer.empty();
		const svg = this.buildSvg(newWidth, neededSvgWidth);
		if (this.intendedMarginLeft > 0) {
			svg.style.marginLeft = `${this.intendedMarginLeft}px`;
		}
		this.scrollContainer.appendChild(svg);

		if (this.scrollRafId !== null) {
			cancelAnimationFrame(this.scrollRafId);
		}
		this.scrollRafId = requestAnimationFrame(() => {
			this.scrollRafId = null;
			if (!this.scrollContainer) return;
			if (this.intendedScrollLeft !== null) {
				this.scrollContainer.scrollLeft = this.intendedScrollLeft;
				this.intendedScrollLeft = null;
			} else {
				const maxScroll =
					this.scrollContainer.scrollWidth -
					this.scrollContainer.clientWidth;
				this.scrollContainer.scrollLeft =
					maxScroll * this.scrollRatio;
			}
			this.updateStickyRangeLabels();
		});
	}
}
