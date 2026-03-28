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
