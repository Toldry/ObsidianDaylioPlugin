import { describe, it, expect, vi } from "vitest";
import {
	App,
	Plugin,
	TFile,
	type SettingDefinitionControl,
	type SettingDefinitionGroup,
	type SettingFileControl,
	type SettingFolderControl,
	type SettingToggleControl,
	type SettingColorControl,
} from "obsidian";
import { DaylioSettingTab } from "../../src/settings-tab";
import { DEFAULT_SETTINGS, type DaylioGraphSettings, type HasDaylioSettings } from "../../src/types";

class MockPlugin extends Plugin implements HasDaylioSettings {
	settings: DaylioGraphSettings;
	saveSettings: () => Promise<void>;

	constructor(app?: App) {
		const mockApp = app ?? new App();
		super(mockApp, {
			id: "daylio-mood-graph",
			name: "Daylio Mood Graph",
			version: "1.1.14",
			minAppVersion: "1.13.0",
			description: "",
			author: "",
			isDesktopOnly: false,
		});
		this.settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
		this.saveSettings = vi.fn().mockResolvedValue(undefined);
	}
}

describe("DaylioSettingTab (Declarative Settings)", () => {
	it("returns declarative setting definitions", () => {
		const app = new App();
		const plugin = new MockPlugin(app);
		const tab = new DaylioSettingTab(app, plugin);

		const defs = tab.getSettingDefinitions();
		expect(defs).toHaveLength(4);

		// CSV file path
		const csvDef = defs[0] as SettingDefinitionControl;
		const fileControl = csvDef.control as SettingFileControl;
		expect(csvDef.name).toBe("CSV file path");
		expect(fileControl.type).toBe("file");
		expect(fileControl.key).toBe("csvPath");

		const csvFile = Object.assign(Object.create(TFile.prototype), { extension: "csv" }) as TFile;
		const mdFile = Object.assign(Object.create(TFile.prototype), { extension: "md" }) as TFile;
		expect(fileControl.filter?.(csvFile)).toBe(true);
		expect(fileControl.filter?.(mdFile)).toBe(false);

		// Event scan folder
		const folderDef = defs[1] as SettingDefinitionControl;
		const folderControl = folderDef.control as SettingFolderControl;
		expect(folderDef.name).toBe("Event scan folder");
		expect(folderControl.type).toBe("folder");
		expect(folderControl.key).toBe("eventScanDir");

		// Show event labels
		const labelsDef = defs[2] as SettingDefinitionControl;
		const toggleControl = labelsDef.control as SettingToggleControl;
		expect(labelsDef.name).toBe("Show event labels");
		expect(toggleControl.type).toBe("toggle");
		expect(toggleControl.key).toBe("showEventLabels");

		// Mood colors group
		const group = defs[3] as SettingDefinitionGroup;
		expect(group.type).toBe("group");
		expect(group.heading).toBe("Mood colors");
		const items = group.items ?? [];
		expect(items).toHaveLength(6); // 5 colors + 1 reset button

		const firstItem = items[0] as SettingDefinitionControl;
		const colorControl = firstItem.control as SettingColorControl;
		expect(firstItem.name).toBe("Awful");
		expect(colorControl.type).toBe("color");
		expect(colorControl.key).toBe("moodColors.awful");
	});

	it("reads control values using getControlValue (including dot notation)", () => {
		const app = new App();
		const plugin = new MockPlugin(app);
		plugin.settings.csvPath = "attachments/export.csv";
		plugin.settings.moodColors.rad = "#123456";

		const tab = new DaylioSettingTab(app, plugin);
		expect(tab.getControlValue("csvPath")).toBe("attachments/export.csv");
		expect(tab.getControlValue("showEventLabels")).toBe(true);
		expect(tab.getControlValue("moodColors.rad")).toBe("#123456");
		expect(tab.getControlValue("moodColors.nonexistent")).toBeUndefined();
	});

	it("writes control values using setControlValue (including dot notation and normalization)", async () => {
		const app = new App();
		const plugin = new MockPlugin(app);
		const tab = new DaylioSettingTab(app, plugin);

		await tab.setControlValue("csvPath", "data/daylio.csv");
		expect(plugin.settings.csvPath).toBe("data/daylio.csv");
		expect(plugin.saveSettings).toHaveBeenCalled();

		await tab.setControlValue("eventScanDir", "  entries/subfolder/  ");
		expect(plugin.settings.eventScanDir).toBe("entries/subfolder/");

		await tab.setControlValue("moodColors.rad", "#abcdef");
		expect(plugin.settings.moodColors.rad).toBe("#abcdef");
	});
});
