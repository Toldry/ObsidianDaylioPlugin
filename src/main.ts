/**
 * Daylio Mood Graph — Obsidian plugin entry point.
 *
 * All domain logic lives in sibling modules; this file only wires up
 * the Obsidian plugin lifecycle (load, unload, settings, views).
 */

import { Plugin } from "obsidian";
import {
	DAYLIO_ICON_ID,
	MOOD_LEVELS,
	DEFAULT_MOOD_COLORS,
	DEFAULT_SETTINGS,
	VIEW_TYPE_DAYLIO,
	type DaylioGraphSettings,
} from "./types";
import { DaylioGraphView } from "./graph-view";
import { DaylioSettingTab } from "./settings-tab";

// Re-export pure functions and types so existing test imports keep working.
export {
	type MoodLevel,
	type MoodEntry,
	type DayData,
	type VaultEvent,
	MOOD_LEVELS,
} from "./types";
export {
	parseDaylioCsv,
	parseCsvLine,
	isMoodLevel,
	groupByDay,
} from "./csv-parser";
export {
	scanVaultEvents,
	parseEventString,
	parseFrontmatterDate,
	collectStringItems,
	DATE_PREFIX_REGEX,
} from "./vault-scanner";
export {
	computeEntrySpans,
	packEventsIntoTracks,
	packRangeEventsIntoTracks,
	computeRangeMoodProportions,
	computeStickyLabelPosition,
	type EntrySpan,
	type EventTrackSpan,
	type RangeTrackSpan,
	type MoodProportion,
	type RangeMoodSummary,
	type RangeTooltipData,
	type StickyLabelParams,
	type StickyLabelResult,
} from "./graph-builder";
export {
	computeAnchoredScroll,
	computeIntrinsicWidth,
	type AnchorParams,
	type ScrollResult,
} from "./scroll-math";
export {
	log,
	logDebug,
	logInfo,
	logWarn,
	logError,
} from "./log";

export default class DaylioGraphPlugin extends Plugin {
	settings: DaylioGraphSettings = DEFAULT_SETTINGS;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.registerView(VIEW_TYPE_DAYLIO, (leaf) => {
			return new DaylioGraphView(leaf, this);
		});

		this.addRibbonIcon(DAYLIO_ICON_ID, "Open Daylio mood graph", () => {
			void this.activateView();
		});

		this.addCommand({
			id: "open-graph",
			name: "Open mood graph",
			callback: () => {
				void this.activateView();
			},
		});

		this.addSettingTab(new DaylioSettingTab(this.app, this));
	}

	/** Intentionally empty — Obsidian calls this on plugin unload but we
	 *  have no teardown work beyond what `registerView` handles. */
	onunload(): void {
		// No-op: view cleanup is handled by Obsidian's view lifecycle.
	}

	async loadSettings(): Promise<void> {
		const loaded = await this.loadData();
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			loaded as Partial<DaylioGraphSettings>,
		);
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

	async activateView(): Promise<void> {
		const { workspace } = this.app;

		let leaf = workspace.getLeavesOfType(VIEW_TYPE_DAYLIO)[0];
		if (!leaf) {
			const newLeaf = workspace.getLeaf("split", "horizontal");
			if (!newLeaf) {
				return;
			}
			await newLeaf.setViewState({
				type: VIEW_TYPE_DAYLIO,
				active: true,
			});
			leaf = newLeaf;
		} else {
			// The leaf survived (sidebar collapsed, tab hidden, etc.) so
			// onOpen won't fire again — manually re-render so the view
			// reflects any settings changes made since it was last visible.
			if (leaf.view instanceof DaylioGraphView) {
				await leaf.view.renderGraph();
			}
		}
		void workspace.revealLeaf(leaf);
	}
}
