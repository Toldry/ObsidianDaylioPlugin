import { App, PluginSettingTab, Setting } from "obsidian";
import {
	MOOD_LEVELS,
	DEFAULT_MOOD_COLORS,
	type HasDaylioSettings,
} from "./types";

export class DaylioSettingTab extends PluginSettingTab {
	plugin: HasDaylioSettings;

	constructor(app: App, plugin: HasDaylioSettings & { app: App }) {
		super(app, plugin as any);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h2", { text: "Daylio Mood Graph Settings" });

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
					dropdown.addOption(file.path, file.path);
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
