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

export class WorkspaceLeaf {
	view: unknown;
}

export class Workspace {
	leaves: WorkspaceLeaf[] = [];
	getLeavesOfType(_type: string): WorkspaceLeaf[] {
		return this.leaves;
	}
}

export class Vault {
	getAbstractFileByPath(_path: string): TFile | null {
		return null;
	}
	read(_file: TFile): Promise<string> {
		return Promise.resolve("");
	}
}

export class App {
	workspace: Workspace = new Workspace();
	vault: Vault = new Vault();
}

export class ItemView {
	app: App = new App();
	containerEl: HTMLElement = typeof document !== "undefined" ? document.createElement("div") : ({} as HTMLElement);
	constructor(_leaf: WorkspaceLeaf) {}
	addAction(_icon: string, _title: string, _callback: () => void): void {}
	registerDomEvent(
		el: Window | Document | HTMLElement,
		type: string,
		callback: (ev: Event) => unknown,
		options?: boolean | AddEventListenerOptions,
	): void {
		el.addEventListener(type, callback as EventListener, options);
	}
}

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
	containerEl: HTMLElement = typeof document !== "undefined" ? document.createElement("div") : ({} as HTMLElement);
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
	extension = "";
}

export class Notice {
	constructor(_message: string) {}
}

// Module-level functions
export function addIcon(_iconId: string, _svgContent: string): void {}
export function normalizePath(path: string): string { return path; }

// Minimal DOM helper stubs for test environments
export const createEl = (tag: string): HTMLElement =>
	(typeof document !== "undefined" ? document.createElement(tag) : ({}) as HTMLElement);
export const createDiv = (): HTMLDivElement => createEl("div") as HTMLDivElement;
export const createSpan = (): HTMLSpanElement => createEl("span") as HTMLSpanElement;

(globalThis as unknown as Record<string, unknown>).createEl ??= createEl;
(globalThis as unknown as Record<string, unknown>).createDiv ??= createDiv;
(globalThis as unknown as Record<string, unknown>).createSpan ??= createSpan;

