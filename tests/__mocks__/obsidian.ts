/**
 * Minimal stub of the Obsidian module.
 *
 * Unit tests import from source modules (e.g. src/vault-scanner.ts), which import from "obsidian".
 * vitest.config.ts aliases "obsidian" → this file so the tests can run
 * without a real Obsidian runtime.
 *
 * Only the symbols actually imported by source modules need to be present
 * here.  They don't need real implementations — just enough shape for
 * TypeScript and vitest to be happy.
 */

export class App {}

export class ItemView {
	app: App = new App();
	containerEl: HTMLElement = document.createElement("div");
	constructor(_leaf: WorkspaceLeaf) {}
	addAction(_icon: string, _title: string, _callback: () => void): void {}
}

export class WorkspaceLeaf {}

export class Plugin {
	app: App = new App();
	async loadData(): Promise<unknown> { return {}; }
	async saveData(_data: unknown): Promise<void> {}
	registerView(_type: string, _creator: unknown): void {}
	addRibbonIcon(_icon: string, _title: string, _callback: () => void): void {}
	addCommand(_cmd: unknown): void {}
	addSettingTab(_tab: unknown): void {}
}

export class PluginSettingTab {
	app: App;
	containerEl: HTMLElement = document.createElement("div");
	constructor(app: App, _plugin: unknown) { this.app = app; }
}

export class Setting {
	constructor(_containerEl: HTMLElement) {}
	setName(_name: string): this { return this; }
	setDesc(_desc: string): this { return this; }
	setHeading(): this { return this; }
	addText(_cb: unknown): this { return this; }
	addDropdown(_cb: unknown): this { return this; }
	addToggle(_cb: unknown): this { return this; }
	addColorPicker(_cb: unknown): this { return this; }
	addButton(_cb: unknown): this { return this; }
}

export class TFile {
	path = "";
	basename = "";
}

export class Notice {
	constructor(_message: string) {}
}

// Module-level functions
export function addIcon(_iconId: string, _svgContent: string): void {}
export function normalizePath(path: string): string { return path; }
