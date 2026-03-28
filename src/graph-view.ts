import { App, ItemView, Notice, TFile, WorkspaceLeaf } from "obsidian";
import {
	MOOD_LEVELS,
	VIEW_TYPE_DAYLIO,
	barGapFor,
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
		await this.renderGraph();
	}

	async onClose(): Promise<void> {
		clearTimeout(this.zoomDebounceTimer);
		this.containerEl.empty();
	}

	/** Open a vault file by path, with error notice on failure. */
	private openFile(filePath: string): void {
		const target = this.app.vault.getAbstractFileByPath(filePath);
		if (target instanceof TFile) {
			this.app.workspace.getLeaf(false).openFile(target);
		} else {
			new Notice(`Could not find note: ${filePath}`);
		}
	}

	/** Full re-render — called on open and when settings change. */
	async renderGraph(): Promise<void> {
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

		const stepZoom = (delta: number): void => {
			const newWidth = Math.max(
				0.5,
				Math.min(16, this.plugin.settings.barWidth + delta),
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
		minusBtn.addEventListener("click", () => stepZoom(-0.5));

		const slider = toolbar.createEl("input") as HTMLInputElement;
		slider.type = "range";
		slider.min = "0.5";
		slider.max = "16";
		slider.step = "0.5";
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
		plusBtn.addEventListener("click", () => stepZoom(0.5));

		// ── Collect vault events + cache parsed data ────────────
		this.cachedVaultEvents = scanVaultEvents(this.app, this.plugin.settings.eventScanDir || undefined);
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

		this.scrollContainer.addEventListener(
			"wheel",
			(evt) => {
				evt.preventDefault();
				if (evt.ctrlKey) {
					const step =
						this.plugin.settings.barWidth <= 2 ? 0.5 : 1;
					const delta = evt.deltaY < 0 ? step : -step;
					const newWidth = Math.max(
						0.5,
						Math.min(
							16,
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

	/** Thin wrapper around the pure graph builder, passing context. */
	private buildSvg(barWidth: number): SVGSVGElement {
		return buildGraphSvg(barWidth, this.cachedDays, this.cachedVaultEvents, {
			moodColors: this.plugin.settings.moodColors,
			openFile: (fp) => this.openFile(fp),
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
