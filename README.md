# Daylio Mood Graph — Obsidian Plugin

[![Download Demo Vault](https://img.shields.io/badge/Demo_Vault-Download_Example_Vault-purple?style=for-the-badge&logo=obsidian)](../../releases/latest)

Renders your [Daylio](https://daylio.net/) mood history as a colour-coded
graph inside Obsidian. Notes in your vault can annotate the graph with
labelled, clickable markers at the dates they correspond to.

## Quick Start / Demo Vault

Want to try out the plugin with pre-populated sample data?
Download the **[Example Vault Zip](../../releases/latest)**, extract it, and open it in Obsidian to see a working graph with sample entries and event annotations out of the box!

## What it looks like

Each day in your Daylio export becomes a vertical bar. The bar is split into
segments — one per mood entry that day — each coloured by mood level. Days
with no entry are simply absent. Month boundaries are marked with dashed
lines and labels; year boundaries use a slightly bolder line so they stand
out. At maximum zoom-out only year labels are shown to avoid crowding.
The graph scrolls horizontally and defaults to showing the most recent data.

![](plugin_screenshot.png)

Vault events appear as small labelled cards below the graph (or horizontal swimlane bars for range events), connected to
their date by a dashed connector line. Clicking a card opens the
corresponding note. Hovering over a day column shows the date; hovering
over an event's range highlights the full period that event spans.

## Installation

### From the Community Plugin browser (once published)

1. Open Obsidian → Settings → Community Plugins → Browse.
2. Search for **Daylio Mood Graph** and install.
3. Enable the plugin.

### Manual installation

1. Download `main.js`, `main.js.map`, `manifest.json`, and `styles.css`
   from the latest [GitHub release](../../releases/latest).
   (`main.js` and `main.js.map` are the release assets built from `build/`.)
2. Copy them into your vault at:
   `.obsidian/plugins/daylio-mood-graph/`
3. In Obsidian: Settings → Community Plugins → enable **Daylio Mood Graph**.

## Setup

### 1. Export your data from Daylio

In the Daylio app: **More → Export Entries → CSV (table)**.
Move the resulting file into your vault — `attachments/daylio_export.csv`
is a reasonable location.

### 2. Tell the plugin where the CSV is

Settings → Daylio Mood Graph → **CSV file path**. Enter the path relative
to your vault root, e.g.:

```
attachments/daylio_export.csv
```

### 3. Open the graph

Click the smiley-face icon in the left ribbon, or run the command
**Daylio Mood Graph: Open mood graph** from the command palette
(<kbd>Ctrl</kbd>+<kbd>P</kbd> / <kbd>Cmd</kbd>+<kbd>P</kbd>).

The graph opens as a horizontal split pane below the current editor.

## Navigating the graph

**Scrolling:** drag left/right anywhere in the graph area, or use a
horizontal scroll gesture on a trackpad.

**Zooming:**

| Gesture | Effect |
|---|---|
| Toolbar slider | Smooth zoom, persists between sessions |
| Toolbar − / + buttons | Step zoom |
| <kbd>Ctrl</kbd> + scroll wheel | Zoom centred on the cursor |
| Right-click + scroll wheel | Same as <kbd>Ctrl</kbd> + scroll |

At narrow bar widths (≤ 0.5 px per day) only year labels are shown to keep
the header readable.

## Annotating the graph with vault events

Vault notes can annotate the graph in two ways: **Point Events** (single-date milestones) and **Range Events** (multi-day timeline spans).

### 1. Point Events (Single-Date Milestones)

Add a `daylio_event` field to the frontmatter of any note whose filename starts with `YYYY-MM-DD`:

```yaml
---
daylio_event: "Began university"
---
```

You can also specify multiple point events in a single note using Obsidian's native List property:

```yaml
---
daylio_event:
  - "Got a cat"
  - "Got a dog"
---
```

### 2. Range Events (Multi-Day Timeline Spans / Gantt Swimlanes)

For multi-day events that span across a date range ($T_{\text{start}} \rightarrow T_{\text{end}}$), use the inline pipe (`|`) syntax in frontmatter:

```yaml
---
daylio_event: Summer Vacation | 2024-08-12 -> 2024-08-28
---
```

You can also combine point events and multiple range events in list properties:

```yaml
---
daylio_event:
  - Got a cat
  - Summer Vacation | 2024-08-12 -> 2024-08-28
  - Ongoing Project | 2024-09-01 ->
---
```

Range Events render as horizontal swimlane pill bars below the mood graph. Overlapping events are automatically organized into separate non-overlapping tracks. Clicking any pill opens the corresponding note!

The plugin reads frontmatter through Obsidian's metadata cache — it never
needs to open your notes — so scanning is fast regardless of vault size.

**Notes on the convention:**

- The `daylio_event` value must be a non-empty string.
- Only one event label is shown per date. If two notes share the same date
  prefix, one will silently take precedence (avoid duplicates).
- The date in the filename must correspond to a day that exists in the CSV;
  otherwise the label has no bar to attach to and is not shown.
- Frontmatter is stripped during PDF export, so `daylio_event` never appears
  in printed or exported versions of your notes.

Event labels can be toggled on and off with the **Labels** checkbox in the
graph toolbar without losing your scroll position.

## Settings

| Setting | Description | Default |
|---|---|---|
| CSV file path | Path to your Daylio CSV export, relative to the vault root | *(empty)* |
| Event scan directory | Restrict vault-event scanning to this subdirectory (leave blank to scan the whole vault) | *(empty)* |
| Show event labels | Whether event label cards are shown below the graph | On |
| Mood colours | A colour picker for each of the five mood levels | Daylio palette |
| Reset colours | Restores the default Daylio colour palette | — |

The zoom level is controlled by the toolbar slider.

## Compatibility

- **Minimum Obsidian version:** 0.15.0
- **Platforms:** desktop and mobile

## Development

### Building

```bash
npm install          # first time only
npm run dev          # watch mode with inline source maps
npm run build        # production bundle (type-checks first)
```

After building, copy `build/main.js`, `build/main.js.map`, `manifest.json`,
and `styles.css` into your vault's plugin folder and reload Obsidian.
The shorthand `npm run update:test-vault` builds and copies in one step.

> [!TIP]
> **Developer Workflow Tip:** It is recommended to keybind Obsidian's built-in command **"Reload app without saving"** to a hotkey such as <kbd>Ctrl</kbd>+<kbd>R</kbd> (or <kbd>Cmd</kbd>+<kbd>R</kbd>) under **Settings → Hotkeys**. This enables a rapid development loop: run `npm run update:test-vault`, switch to Obsidian, and press <kbd>Ctrl</kbd>+<kbd>R</kbd> to see your changes instantly.

### Running the tests

The test suite uses [Vitest](https://vitest.dev) and requires no Obsidian
runtime — the Obsidian API is replaced by a minimal stub for unit tests, and
the integration tests read real files directly from `obsidian_daylio_plugin_test_vault/`.

---

## Technical Details

### Architecture & Data Flow

1. **`DaylioGraphView`** (`src/graph-view.ts`): Extends `ItemView` (`VIEW_TYPE_DAYLIO = "daylio-mood-graph"`). Manages layout, controls (zoom slider/buttons, event checkbox), tooltip rendering, and horizontal scroll sync.
2. **`buildGraphSvg`** (`src/graph-builder.ts`): Pure synchronous function. Builds SVG element tree containing date headers, lane dividers, mood bars, month lines, event connector lines, event pills/cards, and hover overlays.
3. **`scanVaultEvents`** (`src/vault-scanner.ts`): Scans the vault for dated notes (`YYYY-MM-DD` in filename). Parses `daylio_event` and `daylio_events` properties (including ranges like `Label | 2024-01-01 -> 2024-01-15`, `to`, `..`, and ongoing ranges).
4. **`parseDaylioCsv` & `groupByDay`** (`src/csv-parser.ts`): Parses Daylio CSV exports, normalizes moods, and groups entries by chronological dates.
5. **Testing**: Unit tests run against pure modules using mock `App` object. Integration tests read `obsidian_daylio_plugin_test_vault/attachments/daylio_export.csv` and all the `.md` notes in `obsidian_daylio_plugin_test_vault/` to verify end-to-end
behaviour against real data, including specific anchor points (known entry
counts, dates, and mood distributions).

The SVG rendering inside `buildGraphSvg` is not covered by automated tests
as it depends on a live browser DOM; test it manually by opening the test
vault in Obsidian.