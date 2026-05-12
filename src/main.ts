/**
 * Daylio Mood Graph — Obsidian plugin entry point.
 *
 * All domain logic lives in sibling modules; this file only wires up
 * the Obsidian plugin lifecycle (load, unload, settings, views).
 */

import { Plugin } from "obsidian";
import log from "./log";
import {
	DAYLIO_ICON_ID,
	MOOD_LEVELS,
	DEFAULT_MOOD_COLORS,
	DEFAULT_SETTINGS,
	VIEW_TYPE_DAYLIO,
	type MoodLevel,
	type MoodEntry,
	type DayData,
	type VaultEvent,
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
	DATE_PREFIX_REGEX,
} from "./vault-scanner";
export {
	computeEntrySpans,
	type EntrySpan,
} from "./graph-builder";
export {
	computeAnchoredScroll,
	computeIntrinsicWidth,
	type AnchorParams,
	type ScrollResult,
} from "./scroll-math";

export default class DaylioGraphPlugin extends Plugin {
	settings: DaylioGraphSettings = DEFAULT_SETTINGS;

	async onload(): Promise<void> {
		// log("plugin loading");
		await this.loadSettings();
		// log("settings loaded:", this.settings);

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
		// log("plugin ready");
	}

	onunload(): void {
		// log("plugin unloading");
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_DAYLIO);
	}

	async loadSettings(): Promise<void> {
		const loaded = await this.loadData();
		// log("raw data from storage:", loaded);
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
		// log("settings after merge:", this.settings);
	}

	async saveSettings(): Promise<void> {
		// log("saving settings:", this.settings);
		await this.saveData(this.settings);
	}

	async activateView(): Promise<void> {
		const { workspace } = this.app;

		let leaf = workspace.getLeavesOfType(VIEW_TYPE_DAYLIO)[0];
		if (!leaf) {
			// log("no existing view leaf; opening in horizontal split");
			const newLeaf = workspace.getLeaf("split", "horizontal");
			if (!newLeaf) {
				// log("could not obtain a leaf; aborting");
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
			// log("reusing existing view leaf; re-rendering graph");
			if (leaf.view instanceof DaylioGraphView) {
				await leaf.view.renderGraph();
			}
		}
		workspace.revealLeaf(leaf);
	}
}
