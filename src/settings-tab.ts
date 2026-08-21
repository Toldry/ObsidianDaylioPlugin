import {
	App,
	Plugin,
	PluginSettingTab,
	Setting,
	normalizePath,
	TFile,
	type SettingDefinitionItem,
} from "obsidian";
import {
	MOOD_LEVELS,
	DEFAULT_MOOD_COLORS,
	VIEW_TYPE_DAYLIO,
	type HasDaylioSettings,
} from "./types";

function getPath(obj: Record<string, unknown>, path: string): unknown {
	let cursor: unknown = obj;
	for (const part of path.split(".")) {
		if (cursor === null || typeof cursor !== "object") return undefined;
		cursor = (cursor as Record<string, unknown>)[part];
	}
	return cursor;
}

function setPath(
	obj: Record<string, unknown>,
	path: string,
	value: unknown,
): void {
	const parts = path.split(".");
	const last = parts.pop();
	if (!last) return;
	let cursor: Record<string, unknown> = obj;
	for (const part of parts) {
		let next = cursor[part];
		if (next === null || typeof next !== "object") {
			next = {};
			cursor[part] = next;
		}
		cursor = next as Record<string, unknown>;
	}
	cursor[last] = value;
}

export class DaylioSettingTab extends PluginSettingTab {
	plugin: HasDaylioSettings;
	private hasChanges = false;

	constructor(app: App, plugin: Plugin & HasDaylioSettings) {
		super(app, plugin);
		this.plugin = plugin;
	}

	getControlValue(key: string): unknown {
		return getPath(
			this.plugin.settings as unknown as Record<string, unknown>,
			key,
		);
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		if (key === "eventScanDir" && typeof value === "string") {
			value = value.trim() ? normalizePath(value.trim()) : "";
		}
		const currentValue = this.getControlValue(key);
		if (currentValue !== value) {
			this.hasChanges = true;
		}
		setPath(
			this.plugin.settings as unknown as Record<string, unknown>,
			key,
			value,
		);
		await this.plugin.saveSettings();
	}

	hide(): void {
		if (this.hasChanges) {
			this.hasChanges = false;
			this.reRenderOpenGraphs();
		}
	}

	private reRenderOpenGraphs(): void {
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_DAYLIO);
		for (const leaf of leaves) {
			const view = leaf.view as unknown as { renderGraph?: () => Promise<void> | void };
			if (typeof view?.renderGraph === "function") {
				void view.renderGraph();
			}
		}
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				name: "CSV file path",
				desc: "Select the Daylio CSV export file from your vault.",
				control: {
					type: "file",
					key: "csvPath",
					filter: (file: unknown) => file instanceof TFile && file.extension === "csv",
					placeholder: "attachments/daylio_export.csv",
				},
			},
			{
				name: "Event scan folder",
				desc: "Vault-relative folder to scan for event notes (e.g. entries). Leave blank to scan the whole vault.",
				control: {
					type: "folder",
					key: "eventScanDir",
					placeholder: "entries",
					includeRoot: true,
				},
			},
			{
				name: "Show event labels",
				desc: "Display the floating label cards for notes that have a daylio_event frontmatter field. The column highlights and hover markers are always shown.",
				control: {
					type: "toggle",
					key: "showEventLabels",
				},
			},
			{
				type: "group",
				heading: "Mood colors",
				items: [
					...MOOD_LEVELS.map((mood) => ({
						name: mood.charAt(0).toUpperCase() + mood.slice(1),
						control: {
							type: "color" as const,
							key: `moodColors.${mood}`,
						},
					})),
					{
						name: "Reset colors to defaults",
						render: (setting: Setting) => {
							setting.addButton((btn) =>
								btn.setButtonText("Reset").onClick(async () => {
									this.hasChanges = true;
									this.plugin.settings.moodColors = {
										...DEFAULT_MOOD_COLORS,
									};
									await this.plugin.saveSettings();
									if (
										typeof (
											this as unknown as {
												update?: () => void;
											}
										).update === "function"
									) {
										(
											this as unknown as {
												update: () => void;
											}
										).update();
									}
								}),
							);
						},
					},
				],
			},
		];
	}
}
