import { App, ItemView, Notice, TFile, WorkspaceLeaf } from "obsidian";
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
		return DAYLIO_ICON_ID
	}

	async onOpen(): Promise<void> {
		await this.renderGraph();
	}

	onClose(): Promise<void> {
		clearTimeout(this.zoomDebounceTimer);
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
				const scrollLeft =
					this.intendedScrollLeft ??
					this.scrollContainer.scrollLeft;
				const svgX =
					scrollLeft + viewportX - this.intendedMarginLeft;
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
			const viewportX = this.scrollContainer.clientWidth / 2;
			const scrollLeft =
				this.intendedScrollLeft ??
				this.scrollContainer.scrollLeft;
			const svgX =
				scrollLeft + viewportX - this.intendedMarginLeft;
			const oldBW = this.plugin.settings.barWidth;
			this.quickRedraw(newWidth, {
				svgX,
				viewportX,
				oldStride: oldBW + barGapFor(oldBW),
			});
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
			if (this.scrollContainer) {
				const viewportX = this.scrollContainer.clientWidth / 2;
				const scrollLeft =
					this.intendedScrollLeft ??
					this.scrollContainer.scrollLeft;
				const svgX =
					scrollLeft + viewportX - this.intendedMarginLeft;
				const bw = this.plugin.settings.barWidth;
				this.quickRedraw(bw, {
					svgX,
					viewportX,
					oldStride: bw + barGapFor(bw),
				});
			} else {
				this.quickRedraw(this.plugin.settings.barWidth);
			}
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

		// ── Collect vault events + cache parsed data ────────────
		this.cachedVaultEvents = scanVaultEvents(
			this.app,
			this.plugin.settings.eventScanDir || undefined,
		);
		this.cachedDays = groupByDay(allEntries);

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
			if (evt.button === 2) rightButtonHeld = true;
		});
		// Release on mouseup anywhere — the pointer may have drifted off
		// the scroll container while held.  Use registerDomEvent so the
		// listener is removed when the view closes (not a bare document
		// listener that accumulates across renderGraph() calls).
		this.registerDomEvent(document, "mouseup", (evt: MouseEvent) => {
			if (evt.button === 2) rightButtonHeld = false;
		});
		// Suppress the context menu when right-button was used for zooming.
		// Only fires when the button is released without having scrolled, so
		// normal (non-scrolling) right-clicks still work outside this element.
		this.scrollContainer.addEventListener("contextmenu", (evt) => {
			if (rightButtonHeld) evt.preventDefault();
		});

		this.scrollContainer.addEventListener(
			"wheel",
			(evt) => {
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
		// log(
		// 	"quickRedraw:", this.plugin.settings.barWidth, "→", newWidth,
		// 	anchor ? "(cursor-anchored)" : "(absolute-position scroll)",
		// );
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
		});
	}
}
