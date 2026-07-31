import { App, Plugin, PluginSettingTab, Setting, normalizePath } from "obsidian";
import {
	MOOD_LEVELS,
	DEFAULT_MOOD_COLORS,
	type HasDaylioSettings,
} from "./types";
import { DATE_PREFIX_REGEX } from "./vault-scanner";

export class DaylioSettingTab extends PluginSettingTab {
	plugin: HasDaylioSettings;

	constructor(app: App, plugin: Plugin & HasDaylioSettings) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// ── CSV file picker ─────────────────────────────────────
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
					: "Select the Daylio CSV export file from your vault.",
			)
			.addDropdown((dropdown) => {
				dropdown.addOption("", "— choose a file —");

				for (const file of csvFiles) {
					dropdown.addOption(file.path, normalizePath(file.path));
				}

				if (
					currentPath &&
					!csvFiles.some((f) => f.path === currentPath)
				) {
					dropdown.addOption(
						currentPath,
						`${currentPath} ⚠ not found`,
					);
				}

				dropdown
					.setValue(currentPath)
					.onChange(async (value) => {
						this.plugin.settings.csvPath = value;
						await this.plugin.saveSettings();
					});
			});

		// ── Event scan directory ─────────────────────────────────
		const scanDirDesc = (dir: string): string => {
			const base =
				"Vault-relative subdirectory to scan for event notes (e.g. entries). " +
				"Leave blank to scan the whole vault.";
			const trimmed = dir.trim();
			if (!trimmed) return base;
			const prefix = trimmed.replace(/\/+$/, "") + "/";
			const count = this.app.vault
				.getMarkdownFiles()
				.filter((f) => f.path.startsWith(prefix) && DATE_PREFIX_REGEX.test(f.basename))
				.length;
			return `${base} — ${count} valid date-prefixed note${count === 1 ? "" : "s"} found in "${trimmed}".`;
		};

		const scanDirSetting = new Setting(containerEl)
			.setName("Event scan directory")
			.setDesc(scanDirDesc(this.plugin.settings.eventScanDir))
			.addText((text) =>
				text
					.setPlaceholder("entries")
					.setValue(this.plugin.settings.eventScanDir)
					.onChange(async (value) => {
						const trimmed = normalizePath(value.trim());
						this.plugin.settings.eventScanDir = trimmed;
						await this.plugin.saveSettings();
						scanDirSetting.setDesc(scanDirDesc(value));
					})
			);

		new Setting(containerEl)
			.setName("Show event labels")
			.setDesc(
				"Display the floating label cards for notes that have a " +
				"daylio_event frontmatter field. " +
				"The column highlights and hover markers are always shown.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.showEventLabels)
					.onChange(async (value) => {
						this.plugin.settings.showEventLabels = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl).setName("Mood colours").setHeading();

		for (const mood of MOOD_LEVELS) {
			new Setting(containerEl)
				.setName(mood.charAt(0).toUpperCase() + mood.slice(1))
				.addColorPicker((picker) =>
					picker
						.setValue(this.plugin.settings.moodColors[mood])
						.onChange(async (value) => {
							this.plugin.settings.moodColors[mood] = value;
							await this.plugin.saveSettings();
						}),
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
					this.display();
				}),
			);
	}
}
