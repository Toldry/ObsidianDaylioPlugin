/**
 * Unit & integration tests for DaylioGraphView.
 *
 * Tests view lifecycle, pop-out window dynamic scoping (win / doc),
 * pointer-based drag-to-pan with capture, and synchronous zoom positioning.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DaylioGraphView } from "../../src/graph-view";
import {
	DEFAULT_SETTINGS,
	MouseButton,
	type DaylioGraphSettings,
	type HasDaylioSettings,
} from "../../src/types";
import { App, WorkspaceLeaf, TFile, Keymap } from "obsidian";

class MockPlugin implements HasDaylioSettings {
	app = new App();
	manifest = { id: "daylio-mood-graph", name: "Daylio Mood Graph", version: "1.1.22", minAppVersion: "0.15.0" };
	settings: DaylioGraphSettings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
	saveSettings = vi.fn().mockResolvedValue(undefined);
}

// ── Minimal Self-Contained Mock DOM ─────────────────────────────────────

type EventCallback = (evt: any) => void;

class MockEventTarget {
	listeners: Map<string, { callback: EventCallback; capture?: boolean }[]> = new Map();

	addEventListener(type: string, callback: EventCallback, options?: boolean | { capture?: boolean }): void {
		const capture = typeof options === "boolean" ? options : !!options?.capture;
		const list = this.listeners.get(type) ?? [];
		list.push({ callback, capture });
		this.listeners.set(type, list);
	}

	removeEventListener(type: string, callback: EventCallback, _options?: boolean | { capture?: boolean }): void {
		const list = this.listeners.get(type);
		if (!list) return;
		this.listeners.set(
			type,
			list.filter((entry) => entry.callback !== callback),
		);
	}

	dispatchEvent(evt: any): boolean {
		const list = this.listeners.get(evt.type) ?? [];
		evt.target = this;
		evt.currentTarget = this;
		for (const entry of list) {
			if (evt._stoppedImmediate) break;
			entry.callback.call(this, evt);
		}
		return !evt.defaultPrevented;
	}
}

class MockElement extends MockEventTarget {
	tagName: string;
	className = "";
	textContent = "";
	style: Record<string, string> = {};
	attributes: Map<string, string> = new Map();
	children: MockElement[] = [];
	parentElement: MockElement | null = null;
	ownerDocument: MockDocument | null = null;
	scrollLeft = 0;
	scrollWidth = 1000;
	clientWidth = 500;
	capturedPointerIds = new Set<number>();

	constructor(tagName: string, ownerDoc: MockDocument | null = null) {
		super();
		this.tagName = tagName.toUpperCase();
		this.ownerDocument = ownerDoc;
	}

	get firstChild(): MockElement | null {
		return this.children[0] ?? null;
	}

	setAttribute(name: string, value: string): void {
		this.attributes.set(name, value);
	}

	getAttribute(name: string): string | null {
		return this.attributes.get(name) ?? null;
	}

	appendChild<T extends MockElement>(child: T): T {
		child.parentElement = this;
		this.children.push(child);
		return child;
	}

	removeChild<T extends MockElement>(child: T): T {
		const idx = this.children.indexOf(child);
		if (idx !== -1) {
			this.children.splice(idx, 1);
			child.parentElement = null;
		}
		return child;
	}

	empty(): void {
		while (this.children.length > 0) {
			this.removeChild(this.children[0]!);
		}
	}

	get classList() {
		return {
			add: (...classes: string[]) => {
				const current = new Set(this.className.split(" ").filter(Boolean));
				classes.forEach((c) => current.add(c));
				this.className = Array.from(current).join(" ");
			},
			remove: (...classes: string[]) => {
				const current = new Set(this.className.split(" ").filter(Boolean));
				classes.forEach((c) => current.delete(c));
				this.className = Array.from(current).join(" ");
			},
			contains: (cls: string) => {
				return this.className.split(" ").filter(Boolean).includes(cls);
			},
		};
	}

	addClass(...classes: string[]): void {
		this.classList.add(...classes);
	}

	removeClass(...classes: string[]): void {
		this.classList.remove(...classes);
	}

	createDiv(o?: { cls?: string }): MockElement {
		const div = new MockElement("div", this.ownerDocument);
		if (o?.cls) div.className = o.cls;
		this.appendChild(div);
		return div;
	}

	createEl(tag: string, o?: { text?: string; cls?: string }): MockElement {
		const el = new MockElement(tag, this.ownerDocument);
		if (o?.cls) el.className = o.cls;
		if (o?.text) el.textContent = o.text;
		this.appendChild(el);
		return el;
	}

	createSpan(o?: { text?: string; cls?: string }): MockElement {
		return this.createEl("span", o);
	}

	setPointerCapture(id: number): void {
		this.capturedPointerIds.add(id);
	}

	hasPointerCapture(id: number): boolean {
		return this.capturedPointerIds.has(id);
	}

	releasePointerCapture(id: number): void {
		this.capturedPointerIds.delete(id);
	}

	getBoundingClientRect() {
		return {
			left: 0,
			top: 0,
			right: 500,
			bottom: 300,
			width: 500,
			height: 300,
			x: 0,
			y: 0,
			toJSON: () => {},
		};
	}

	getContext(_contextId: string): any {
		return null;
	}

	querySelector(selector: string): MockElement | null {
		const className = selector.replace(/^\./, "");
		if (this.classList.contains(className)) return this;
		for (const child of this.children) {
			const found = child.querySelector(selector);
			if (found) return found;
		}
		return null;
	}

	querySelectorAll(_selector: string): MockElement[] {
		return [];
	}
}

class MockDocument extends MockEventTarget {
	body: MockElement;
	defaultView: MockWindow | null = null;

	constructor() {
		super();
		this.body = new MockElement("body", this);
	}

	createElement(tag: string): MockElement {
		return new MockElement(tag, this);
	}

	createElementNS(_ns: string, tag: string): MockElement {
		return new MockElement(tag, this);
	}
}

class MockWindow extends MockEventTarget {
	document: MockDocument;
	setTimeout = vi.fn((fn: () => void, ms?: number) => {
		return (setTimeout as unknown as (fn: () => void, ms?: number) => number)(fn, ms);
	});
	clearTimeout = vi.fn((id?: number) => {
		(clearTimeout as unknown as (id?: number) => void)(id);
	});
	requestAnimationFrame = vi.fn((cb: FrameRequestCallback) => {
		return (setTimeout as unknown as (fn: () => void, ms?: number) => number)(() => cb(Date.now()), 0);
	});
	cancelAnimationFrame = vi.fn((id: number) => {
		(clearTimeout as unknown as (id?: number) => void)(id);
	});

	constructor() {
		super();
		this.document = new MockDocument();
		this.document.defaultView = this;
	}
}

class MockBaseEvent {
	type: string;
	bubbles: boolean;
	cancelable: boolean;
	defaultPrevented = false;
	_stoppedImmediate = false;
	target: any = null;
	currentTarget: any = null;

	constructor(type: string, options?: { bubbles?: boolean; cancelable?: boolean }) {
		this.type = type;
		this.bubbles = !!options?.bubbles;
		this.cancelable = !!options?.cancelable;
	}

	preventDefault(): void {
		this.defaultPrevented = true;
	}

	stopPropagation(): void {}

	stopImmediatePropagation(): void {
		this._stoppedImmediate = true;
	}
}

class MockPointerEvent extends MockBaseEvent {
	button: number;
	buttons: number;
	clientX: number;
	clientY: number;
	pointerId: number;

	constructor(type: string, options?: { button?: number; buttons?: number; clientX?: number; clientY?: number; pointerId?: number; bubbles?: boolean; cancelable?: boolean }) {
		super(type, options);
		this.button = options?.button ?? 0;
		this.buttons = options?.buttons ?? 0;
		this.clientX = options?.clientX ?? 0;
		this.clientY = options?.clientY ?? 0;
		this.pointerId = options?.pointerId ?? 0;
	}
}

class MockWheelEvent extends MockBaseEvent {
	ctrlKey: boolean;
	buttons: number;
	deltaX: number;
	deltaY: number;
	clientX: number;
	clientY: number;

	constructor(type: string, options?: { ctrlKey?: boolean; buttons?: number; deltaX?: number; deltaY?: number; clientX?: number; clientY?: number; bubbles?: boolean; cancelable?: boolean }) {
		super(type, options);
		this.ctrlKey = !!options?.ctrlKey;
		this.buttons = options?.buttons ?? 0;
		this.deltaX = options?.deltaX ?? 0;
		this.deltaY = options?.deltaY ?? 0;
		this.clientX = options?.clientX ?? 0;
		this.clientY = options?.clientY ?? 0;
	}
}

describe("DaylioGraphView (Multi-Window & Pop-out Window Support)", () => {
	let plugin: MockPlugin;
	let leaf: WorkspaceLeaf;
	let mainWindow: MockWindow;
	let popoutWindow: MockWindow;
	let containerEl: MockElement;
	let contentEl: MockElement;

	beforeEach(() => {
		plugin = new MockPlugin();
		leaf = new WorkspaceLeaf();

		mainWindow = new MockWindow();
		popoutWindow = new MockWindow();

		// Set global document/window mocks
		(globalThis as any).window = mainWindow;
		(globalThis as any).document = mainWindow.document;
		(globalThis as any).PointerEvent = MockPointerEvent;
		(globalThis as any).WheelEvent = MockWheelEvent;
		(globalThis as any).MouseEvent = MockPointerEvent;

		// Build container in popout window
		containerEl = new MockElement("div", popoutWindow.document);
		containerEl.appendChild(new MockElement("div", popoutWindow.document)); // header
		contentEl = new MockElement("div", popoutWindow.document); // content
		containerEl.appendChild(contentEl);
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it("resolves win and doc to the pop-out window hosting containerEl", () => {
		const view = new DaylioGraphView(leaf, plugin);
		(view as any).containerEl = containerEl;

		expect((view as any).doc).toBe(popoutWindow.document);
		expect((view as any).win).toBe(popoutWindow);
	});

	it("falls back to global window and document if container has no ownerDocument", () => {
		const view = new DaylioGraphView(leaf, plugin);
		const bareContainer = new MockElement("div", null);
		(view as any).containerEl = bareContainer;

		expect((view as any).doc).toBe(mainWindow.document);
		expect((view as any).win).toBe(mainWindow);
	});

	it("cleans up timers and panning class on the pop-out window on onClose", async () => {
		const view = new DaylioGraphView(leaf, plugin);
		(view as any).containerEl = containerEl;
		popoutWindow.document.body.classList.add("daylio-is-panning");

		await view.onClose();

		expect(popoutWindow.document.body.classList.contains("daylio-is-panning")).toBe(false);
		expect(popoutWindow.clearTimeout).toHaveBeenCalled();
	});

	describe("drag-to-pan with pointer capture", () => {
		it("captures pointer, sets is-panning class on popoutDoc.body, and scrolls when drag exceeds threshold", () => {
			const view = new DaylioGraphView(leaf, plugin);
			(view as any).containerEl = containerEl;

			const scrollEl = new MockElement("div", popoutWindow.document);
			scrollEl.scrollLeft = 100;
			vi.spyOn(scrollEl, "setPointerCapture");
			vi.spyOn(scrollEl, "releasePointerCapture");

			(view as any).setupDragPan(scrollEl as unknown as HTMLElement);

			// 1. Primary button pointerdown (does not capture pointer yet to avoid swallowing clicks)
			const downEvt = new MockPointerEvent("pointerdown", {
				button: MouseButton.Main,
				clientX: 200,
				pointerId: 42,
				bubbles: true,
			});
			scrollEl.dispatchEvent(downEvt);

			expect(scrollEl.setPointerCapture).not.toHaveBeenCalled();
			expect(popoutWindow.document.body.classList.contains("daylio-is-panning")).toBe(false);

			// 2. Pointer move: drag right by 50px (scroll left by 50px) - exceeds 4px threshold
			const moveEvt = new MockPointerEvent("pointermove", {
				clientX: 250,
				pointerId: 42,
				bubbles: true,
			});
			scrollEl.dispatchEvent(moveEvt);

			expect(scrollEl.setPointerCapture).toHaveBeenCalledWith(42);
			expect(popoutWindow.document.body.classList.contains("daylio-is-panning")).toBe(true);
			expect(mainWindow.document.body.classList.contains("daylio-is-panning")).toBe(false); // Main window unaffected
			expect(scrollEl.scrollLeft).toBe(50);

			// 3. Pointer up: release capture and remove panning class
			const upEvt = new MockPointerEvent("pointerup", {
				clientX: 250,
				pointerId: 42,
				bubbles: true,
			});
			scrollEl.dispatchEvent(upEvt);

			expect(scrollEl.releasePointerCapture).toHaveBeenCalledWith(42);
			expect(popoutWindow.document.body.classList.contains("daylio-is-panning")).toBe(false);
		});

		it("suppresses click event if drag distance exceeded threshold", () => {
			const view = new DaylioGraphView(leaf, plugin);
			(view as any).containerEl = containerEl;

			const scrollEl = new MockElement("div", popoutWindow.document);
			(view as any).setupDragPan(scrollEl as unknown as HTMLElement);

			// Drag 10px (> 4px threshold)
			scrollEl.dispatchEvent(new MockPointerEvent("pointerdown", { button: MouseButton.Main, clientX: 100, pointerId: 1 }));
			scrollEl.dispatchEvent(new MockPointerEvent("pointermove", { clientX: 110, pointerId: 1 }));
			scrollEl.dispatchEvent(new MockPointerEvent("pointerup", { clientX: 110, pointerId: 1 }));

			// Dispatch click
			const clickEvt = new MockBaseEvent("click", { cancelable: true, bubbles: true });
			scrollEl.dispatchEvent(clickEvt);

			expect(clickEvt.defaultPrevented).toBe(true);
		});

		it("allows click event if drag distance is below threshold", () => {
			const view = new DaylioGraphView(leaf, plugin);
			(view as any).containerEl = containerEl;

			const scrollEl = new MockElement("div", popoutWindow.document);
			(view as any).setupDragPan(scrollEl as unknown as HTMLElement);

			// Tiny drag of only 1px (< 4px threshold)
			scrollEl.dispatchEvent(new MockPointerEvent("pointerdown", { button: MouseButton.Main, clientX: 100, pointerId: 1 }));
			scrollEl.dispatchEvent(new MockPointerEvent("pointermove", { clientX: 101, pointerId: 1 }));
			scrollEl.dispatchEvent(new MockPointerEvent("pointerup", { clientX: 101, pointerId: 1 }));

			const clickEvt = new MockBaseEvent("click", { cancelable: true, bubbles: true });
			scrollEl.dispatchEvent(clickEvt);

			expect(clickEvt.defaultPrevented).toBe(false);
		});
	});

	describe("synchronous zoom & anchor retention in popout window", () => {
		it("restores scrollLeft synchronously in quickRedraw without waiting for RAF", () => {
			const view = new DaylioGraphView(leaf, plugin);
			(view as any).containerEl = containerEl;

			const scrollEl = new MockElement("div", popoutWindow.document);
			scrollEl.clientWidth = 600;
			scrollEl.scrollWidth = 2000;

			(view as any).scrollContainer = scrollEl;
			(view as any).cachedDays = [
				{ date: "2024-01-01", entries: [] },
				{ date: "2024-01-02", entries: [] },
				{ date: "2024-01-03", entries: [] },
			];

			plugin.settings.barWidth = 4;

			// Perform quickRedraw with anchor
			(view as any).quickRedraw(8, {
				svgX: 400,
				viewportX: 200,
				oldStride: 4,
			});

			expect(plugin.settings.barWidth).toBe(8);
			expect(scrollEl.children.length).toBe(1);
			expect(scrollEl.scrollLeft).toBeGreaterThan(0);
		});

		it("zooms via wheel event when ctrlKey is true or secondary button is held", () => {
			const view = new DaylioGraphView(leaf, plugin);
			(view as any).containerEl = containerEl;

			const scrollEl = new MockElement("div", popoutWindow.document);
			scrollEl.clientWidth = 600;
			scrollEl.scrollWidth = 2000;

			(view as any).scrollContainer = scrollEl;
			(view as any).cachedDays = [
				{ date: "2024-01-01", entries: [] },
				{ date: "2024-01-02", entries: [] },
			];

			plugin.settings.barWidth = 4;

			// Wheel event with ctrlKey
			const wheelEvt = new MockWheelEvent("wheel", {
				ctrlKey: true,
				deltaY: -100, // Zoom in
				clientX: 350,
				cancelable: true,
			});

			(view as any).handleWheel(wheelEvt, false);

			expect(plugin.settings.barWidth).toBeGreaterThan(4);
			expect(popoutWindow.setTimeout).toHaveBeenCalled();
		});
	});

	describe("renderConfigNotice and openSettings", () => {
		it("renders config notice CTA when CSV path is not configured", async () => {
			plugin.settings.csvPath = "";
			const view = new DaylioGraphView(leaf, plugin);
			(view as any).containerEl = containerEl;

			await view.renderGraph();

			const notice = contentEl.querySelector(".daylio-graph-notice");
			expect(notice).not.toBeNull();
			expect(notice?.textContent).toContain("No CSV path configured");

			const btn = contentEl.querySelector(".daylio-open-settings-btn");
			expect(btn).not.toBeNull();
		});

		it("renders config notice CTA when CSV file is missing from vault", async () => {
			plugin.settings.csvPath = "missing.csv";
			const view = new DaylioGraphView(leaf, plugin);
			(view as any).containerEl = containerEl;

			vi.spyOn(view.app.vault, "getAbstractFileByPath").mockReturnValue(null);

			await view.renderGraph();

			const notice = contentEl.querySelector(".daylio-graph-notice");
			expect(notice).not.toBeNull();
			expect(notice?.textContent).toContain("CSV file not found");
		});

		it("opens settings tab when openSettings CTA is clicked", () => {
			const view = new DaylioGraphView(leaf, plugin);
			(view as any).containerEl = containerEl;

			const mockOpenTabById = vi.fn();
			const mockOpen = vi.fn();
			(view.app as unknown as { setting: { open: () => void; openTabById: (id: string) => void } }).setting = {
				open: mockOpen,
				openTabById: mockOpenTabById,
			};

			(view as any).openSettings();

			expect(mockOpen).toHaveBeenCalled();
			expect(mockOpenTabById).toHaveBeenCalledWith("daylio-mood-graph");
		});
	});

	describe("openFile (popout window and cross-window navigation)", () => {
		it("routes to main window rootSplit when graph is in an isolated popout window without notes", async () => {
			const view = new DaylioGraphView(leaf, plugin);
			(view as any).containerEl = containerEl; // popoutWindow container

			const mockTargetFile = new TFile();
			mockTargetFile.path = "entries/2024-01-01 Note.md";
			vi.spyOn(view.app.vault, "getAbstractFileByPath").mockReturnValue(mockTargetFile);

			const mainLeaf = new WorkspaceLeaf();
			const openFileSpy = vi.spyOn(mainLeaf, "openFile").mockResolvedValue(undefined);
			const setActiveLeafSpy = vi.spyOn(view.app.workspace, "setActiveLeaf");
			vi.spyOn(view.app.workspace, "getMostRecentLeaf").mockReturnValue(mainLeaf);

			(view as any).openFile("entries/2024-01-01 Note.md");

			expect(view.app.workspace.getMostRecentLeaf).toHaveBeenCalledWith(view.app.workspace.rootSplit);
			expect(openFileSpy).toHaveBeenCalledWith(mockTargetFile);
			await Promise.resolve();
			expect(setActiveLeafSpy).toHaveBeenCalledWith(mainLeaf, { focus: true });
		});

		it("falls back to getLeaf('tab') in main window when rootSplit has no active leaves", async () => {
			const view = new DaylioGraphView(leaf, plugin);
			(view as any).containerEl = containerEl;

			const mockTargetFile = new TFile();
			mockTargetFile.path = "entries/2024-01-01 Note.md";
			vi.spyOn(view.app.vault, "getAbstractFileByPath").mockReturnValue(mockTargetFile);

			const newTabLeaf = new WorkspaceLeaf();
			const openFileSpy = vi.spyOn(newTabLeaf, "openFile").mockResolvedValue(undefined);
			const setActiveLeafSpy = vi.spyOn(view.app.workspace, "setActiveLeaf");

			vi.spyOn(view.app.workspace, "getMostRecentLeaf").mockReturnValue(null);
			vi.spyOn(view.app.workspace, "getLeaf").mockReturnValue(newTabLeaf);

			(view as any).openFile("entries/2024-01-01 Note.md");

			expect(view.app.workspace.getLeaf).toHaveBeenCalledWith("tab");
			expect(openFileSpy).toHaveBeenCalledWith(mockTargetFile);
			await Promise.resolve();
			expect(setActiveLeafSpy).toHaveBeenCalledWith(newTabLeaf, { focus: true });
		});

		it("handles mod === 'tab' (Ctrl/Cmd+Click) from isolated popout window", async () => {
			const view = new DaylioGraphView(leaf, plugin);
			(view as any).containerEl = containerEl;

			const mockTargetFile = new TFile();
			mockTargetFile.path = "entries/2024-01-01 Note.md";
			vi.spyOn(view.app.vault, "getAbstractFileByPath").mockReturnValue(mockTargetFile);

			const tabLeaf = new WorkspaceLeaf();
			const openFileSpy = vi.spyOn(tabLeaf, "openFile").mockResolvedValue(undefined);
			const setActiveLeafSpy = vi.spyOn(view.app.workspace, "setActiveLeaf");

			vi.spyOn(Keymap, "isModEvent").mockReturnValue("tab");
			vi.spyOn(view.app.workspace, "getLeaf").mockReturnValue(tabLeaf);

			const fakeMouseEvent = new MockPointerEvent("click") as unknown as MouseEvent;
			(view as any).openFile("entries/2024-01-01 Note.md", fakeMouseEvent);

			expect(view.app.workspace.getLeaf).toHaveBeenCalledWith("tab");
			expect(openFileSpy).toHaveBeenCalledWith(mockTargetFile);
			await Promise.resolve();
			expect(setActiveLeafSpy).toHaveBeenCalledWith(tabLeaf, { focus: true });
		});

		it("handles mod === 'split' (Ctrl/Cmd+Alt+Click) from isolated popout window", async () => {
			const view = new DaylioGraphView(leaf, plugin);
			(view as any).containerEl = containerEl;

			const mockTargetFile = new TFile();
			mockTargetFile.path = "entries/2024-01-01 Note.md";
			vi.spyOn(view.app.vault, "getAbstractFileByPath").mockReturnValue(mockTargetFile);

			const activeMainLeaf = new WorkspaceLeaf();
			const splitLeaf = new WorkspaceLeaf();
			const openFileSpy = vi.spyOn(splitLeaf, "openFile").mockResolvedValue(undefined);
			const setActiveLeafSpy = vi.spyOn(view.app.workspace, "setActiveLeaf");

			vi.spyOn(Keymap, "isModEvent").mockReturnValue("split");
			vi.spyOn(view.app.workspace, "getMostRecentLeaf").mockReturnValue(activeMainLeaf);
			vi.spyOn(view.app.workspace, "createLeafBySplit").mockReturnValue(splitLeaf);

			const fakeMouseEvent = new MockPointerEvent("click") as unknown as MouseEvent;
			(view as any).openFile("entries/2024-01-01 Note.md", fakeMouseEvent);

			expect(view.app.workspace.createLeafBySplit).toHaveBeenCalledWith(activeMainLeaf);
			expect(openFileSpy).toHaveBeenCalledWith(mockTargetFile);
			await Promise.resolve();
			expect(setActiveLeafSpy).toHaveBeenCalledWith(splitLeaf, { focus: true });
		});

		it("handles mod === 'window' (Ctrl/Cmd+Alt+Shift+Click) from isolated popout window", async () => {
			const view = new DaylioGraphView(leaf, plugin);
			(view as any).containerEl = containerEl;

			const mockTargetFile = new TFile();
			mockTargetFile.path = "entries/2024-01-01 Note.md";
			vi.spyOn(view.app.vault, "getAbstractFileByPath").mockReturnValue(mockTargetFile);

			const popoutLeaf = new WorkspaceLeaf();
			const openFileSpy = vi.spyOn(popoutLeaf, "openFile").mockResolvedValue(undefined);
			const setActiveLeafSpy = vi.spyOn(view.app.workspace, "setActiveLeaf");

			vi.spyOn(Keymap, "isModEvent").mockReturnValue("window");
			vi.spyOn(view.app.workspace, "getLeaf").mockReturnValue(popoutLeaf);

			const fakeMouseEvent = new MockPointerEvent("click") as unknown as MouseEvent;
			(view as any).openFile("entries/2024-01-01 Note.md", fakeMouseEvent);

			expect(view.app.workspace.getLeaf).toHaveBeenCalledWith("window");
			expect(openFileSpy).toHaveBeenCalledWith(mockTargetFile);
			await Promise.resolve();
			expect(setActiveLeafSpy).toHaveBeenCalledWith(popoutLeaf, { focus: true });
		});

		it("delegates to openLinkText when popout window contains another note tab", () => {
			const view = new DaylioGraphView(leaf, plugin);
			(view as any).containerEl = containerEl; // in popoutWindow

			const mockTargetFile = new TFile();
			mockTargetFile.path = "entries/2024-01-01 Note.md";
			vi.spyOn(view.app.vault, "getAbstractFileByPath").mockReturnValue(mockTargetFile);
			const openLinkSpy = vi.spyOn(view.app.workspace, "openLinkText").mockResolvedValue(undefined);

			// Add a markdown note leaf in the popout window
			const noteLeaf = new WorkspaceLeaf();
			noteLeaf.view = {
				getViewType: () => "markdown",
				containerEl: new MockElement("div", popoutWindow.document) as unknown as HTMLElement,
			} as any;
			vi.spyOn(view.app.workspace, "iterateAllLeaves").mockImplementation((cb) => {
				cb(leaf);
				cb(noteLeaf);
			});

			(view as any).openFile("entries/2024-01-01 Note.md");

			expect(openLinkSpy).toHaveBeenCalledWith("entries/2024-01-01 Note.md", "", false);
		});

		it("delegates to openLinkText when graph view is in the main window", () => {
			const view = new DaylioGraphView(leaf, plugin);
			(view as any).containerEl = new MockElement("div", mainWindow.document) as unknown as HTMLElement; // mainWindow document

			const mockTargetFile = new TFile();
			mockTargetFile.path = "entries/2024-01-01 Note.md";
			vi.spyOn(view.app.vault, "getAbstractFileByPath").mockReturnValue(mockTargetFile);
			const openLinkSpy = vi.spyOn(view.app.workspace, "openLinkText").mockResolvedValue(undefined);

			(view as any).openFile("entries/2024-01-01 Note.md");

			expect(openLinkSpy).toHaveBeenCalledWith("entries/2024-01-01 Note.md", "", false);
		});
	});
});
