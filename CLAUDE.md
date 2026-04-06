# CLAUDE.md — Daylio Mood Graph Plugin

This file tells Claude how to work on this codebase.

## What this project is

An Obsidian community plugin that reads a Daylio CSV export and renders a
colour-coded mood-history graph. Notes in the vault can annotate the graph
with clickable event labels via a `daylio_event` frontmatter field.

## Build commands

```bash
# Install dependencies (first time only)
npm install

# Development — watch mode, rebuilds on every save, includes source maps
npm run dev

# Production — type-checks first, then builds minified bundle with source maps
npm run build

# Build and copy directly into the test vault in one step
npm run build:vault

# Run the test suite once
npm test

# Run tests in watch mode (re-runs on file save)
npm run test:watch

# Run tests with coverage report
npm run test:coverage
```

`npm run dev` runs esbuild in watch mode. It does NOT auto-reload Obsidian;
after a change, press Ctrl+R (or Cmd+R) inside Obsidian to reload the app.

The compiled output is `build/main.js`. Obsidian loads this file (copied
into the vault's plugin folder), not the TypeScript sources directly.

### Source maps and debugging

- **Dev** (`npm run dev`): `sourcemap: "inline"` — the full source map is
  embedded as a base64 data URI inside `main.js`. No external `.map` file is
  fetched, so Obsidian's `app://` scheme never blocks it. After reloading
  Obsidian, TypeScript files appear under DevTools → Sources → Page →
  `plugin:daylio-mood-graph` → `src/`.
- **Prod** (`npm run build`): `sourcemap: "linked"` — writes `build/main.js.map`
  as a separate file and adds a `//# sourceMappingURL=main.js.map` comment.
  Ship `build/main.js.map` alongside `build/main.js` as a release asset.

## Project structure

```
daylio-obsidian-plugin/
├── src/
│   ├── main.ts              ← Plugin entry point + re-exports for tests
│   ├── types.ts             ← Types, interfaces, constants, defaults, icon
│   ├── csv-parser.ts        ← parseDaylioCsv, parseCsvLine, isMoodLevel, groupByDay
│   ├── vault-scanner.ts     ← scanVaultEvents, DATE_PREFIX_REGEX
│   ├── graph-builder.ts     ← buildGraphSvg, computeEntrySpans (pure SVG builder)
│   ├── graph-view.ts        ← DaylioGraphView (Obsidian ItemView subclass)
│   ├── settings-tab.ts      ← DaylioSettingTab (Obsidian PluginSettingTab)
│   └── log.ts               ← Thin debug-logging wrapper (no-ops in production)
├── tests/
│   ├── __mocks__/
│   │   └── obsidian.ts      ← Minimal Obsidian API stub for unit tests
│   ├── helpers/
│   │   └── vault-reader.ts  ← Filesystem-based vault scanner for integration tests
│   ├── unit/
│   │   ├── csv-parser.test.ts   ← Unit tests: isMoodLevel, parseCsvLine, parseDaylioCsv, groupByDay
│   │   └── vault-scanner.test.ts ← Unit tests: scanVaultEvents (with mock App)
│   └── integration/
│       └── test-vault.test.ts   ← Integration tests against real vault files
├── daylio_plugin_test_vault/    ← Test vault (open this in Obsidian to test)
│   ├── .obsidian/
│   │   └── plugins/
│   │       └── daylio-mood-graph/   ← Compiled plugin installed here
│   ├── attachments/
│   │   └── daylio_export.csv    ← Daylio CSV used by the test vault
│   └── entries/                 ← Test notes (event notes, edge cases)
├── manifest.json                ← Plugin metadata (id, name, minAppVersion)
├── package.json
├── tsconfig.json
├── vitest.config.ts             ← Test runner config (aliases obsidian → mock)
├── esbuild.config.mjs
├── styles.css                   ← All CSS (uses Obsidian CSS variables)
└── build/                       ← Compiled output (gitignored) — do not edit by hand
    ├── main.js
    └── main.js.map
```

## Architecture

The source is split into focused modules under `src/`:

- **`types.ts`** — `MoodLevel`, `MoodEntry`, `DayData`, `VaultEvent`, settings
  interfaces, default colours, `barGapFor()`, `MOOD_TO_LANE`, zoom constants
  (`BAR_WIDTH_MIN/MAX/STEP` etc.), the custom ribbon icon registration, and the
  `HasDaylioSettings` interface used to break circular dependencies between the
  graph view and the plugin class.
- **`csv-parser.ts`** — `parseDaylioCsv`, `parseCsvLine`, `isMoodLevel`,
  `groupByDay`. Pure functions, no Obsidian imports.
- **`vault-scanner.ts`** — `scanVaultEvents`, `DATE_PREFIX_REGEX`. Depends
  only on Obsidian `App` and `TFile`. Accepts an optional `scanDir` argument
  to restrict scanning to a vault subdirectory.
- **`graph-builder.ts`** — `buildGraphSvg()` and `computeEntrySpans()`. Both
  are pure synchronous functions exported for testing. `buildGraphSvg` takes
  `DayData[]`, `VaultEvent[]`, and a `GraphBuildContext` (mood colours,
  file-opener callback, `showEventLabels` flag), returning an `SVGSVGElement`.
  `computeEntrySpans` collapses consecutive days that share the same active
  vault entry into contiguous spans, which drive the range-background overlays.
  This is the performance-critical path — mood bars are rendered as one
  `<path>` per mood level (5 path elements) instead of individual `<rect>`
  elements per bar. Lane dividers and month separators are also merged into
  single paths.
- **`graph-view.ts`** — `DaylioGraphView extends ItemView`. Orchestrates CSV
  loading, caching, toolbar/legend UI, zoom (slider, ±buttons, Ctrl+wheel,
  right-click+scroll), and drag-to-pan. Delegates SVG building to
  `buildGraphSvg()`. `quickRedraw()` replaces just the SVG (no CSV re-read)
  and anchors the scroll position either to the cursor (zoom gestures) or to
  the saved `scrollRatio` (label toggle, refresh). The ratio is refreshed from
  the live scroll position at the start of every non-anchored `quickRedraw`
  call to prevent stale-ratio scroll jumps.
- **`settings-tab.ts`** — `DaylioSettingTab extends PluginSettingTab`.
- **`log.ts`** — Debug logging helper; calls are compiled away in production.
- **`main.ts`** — `DaylioGraphPlugin extends Plugin`. Slim entry point that
  wires up the view, ribbon icon, command, and settings tab. Also re-exports
  all pure functions and types so existing test imports (`from "../../src/main"`)
  keep working.

The graph is pure SVG built via `document.createElementNS`. Event labels
use `<foreignObject>` so they can contain a clickable, text-wrapping `<div>`.
Connector lines and label cards are rendered in two passes (connectors first,
then cards) to ensure labels always sit in front of crossing connector lines.

## Key Obsidian API touchpoints

| What | API used |
|---|---|
| Reading vault files | `app.vault.read(file: TFile)` |
| Finding a file by path | `app.vault.getAbstractFileByPath(path)` |
| Reading frontmatter without opening files | `app.metadataCache.getFileCache(file)` |
| Opening a note | `app.workspace.getLeaf(false).openFile(file)` |
| Registering the view | `this.registerView(VIEW_TYPE, creator)` |
| Persisting settings | `this.loadData()` / `this.saveData(data)` |
| Opening in a horizontal split | `workspace.getLeaf("split", "horizontal")` |

**Note on `ItemView.navigation`:** Obsidian's `navigation` property on `View`
does not suppress the back/forward arrow buttons in the view header; they are
rendered unconditionally. Hide them (along with the rest of the header bar)
via CSS targeting `[data-type="<VIEW_TYPE>"] .view-header`. The value must
match `VIEW_TYPE_DAYLIO` exactly — it is the view type string, not the plugin
manifest `id`. See `styles.css`.

## Installing the plugin into the test vault

After building, copy the distributable files into the test vault's plugin
folder. The `build:vault` script does this automatically:

```bash
npm run build:vault
```

Or manually:

```bash
# Unix/macOS
cp build/main.js build/main.js.map manifest.json styles.css \
  daylio_plugin_test_vault/.obsidian/plugins/daylio-mood-graph/

# PowerShell
Copy-Item build\main.js, build\main.js.map, manifest.json, styles.css `
  daylio_plugin_test_vault\.obsidian\plugins\daylio-mood-graph\
```

Then reload Obsidian (Ctrl+R / Cmd+R) while the test vault is open.

## Settings storage

Settings are persisted by Obsidian to
`.obsidian/plugins/daylio-mood-graph/data.json`. The schema is:

```jsonc
{
  "csvPath": "attachments/daylio_export.csv",  // relative to vault root
  "barWidth": 8,           // pixels per bar column (0.25–8); controls zoom
  "showEventLabels": true, // whether event label cards are rendered
  "eventScanDir": "",      // restrict vault scanning to this subdirectory
  "moodColors": {
    "rad":   "#f78c1e",
    "good":  "#41a766",
    "meh":   "#9056a3",
    "bad":   "#5579a7",
    "awful": "#6a777c"
  }
}
```

## Zoom constants (`src/types.ts`)

| Constant | Value | Meaning |
|---|---|---|
| `BAR_WIDTH_MIN` | 0.25 | Minimum bar width in px |
| `BAR_WIDTH_MAX` | 8 | Maximum bar width in px |
| `BAR_WIDTH_STEP` | 0.25 | Slider / ±button step size |
| `BAR_WIDTH_FINE_THRESHOLD` | 2 | Below this, Ctrl+wheel uses the fine step |
| `BAR_WIDTH_FINE_STEP` | 0.25 | Ctrl+wheel step at low zoom (matches ± button step) |
| `BAR_WIDTH_COARSE_STEP` | 0.5 | Ctrl+wheel step at high zoom |

At `barWidth ≤ 0.5` the graph enters "year-only" mode: only year-start labels
are rendered and year separator lines use the `.daylio-year-line` CSS class
(slightly bolder than the regular `.daylio-month-line`).

## Event marker convention

Notes signal a graph event via a frontmatter field:

```yaml
---
daylio_event: "Began university"
---
```

Rules the plugin enforces:
- The note's filename must start with `YYYY-MM-DD`.
- The value must be a non-empty string.
- If two notes share the same date prefix, whichever `metadataCache` returns
  last wins (non-deterministic). Avoid duplicates.
- The date must correspond to a day that exists in the CSV; if not, the event
  is silently ignored (no bar to attach it to).

`scanVaultEvents` returns **all** dated notes (not just those with
`daylio_event`), so the entry-span overlays can cover the full timeline.
The `label` field on `VaultEvent` is optional; only notes with `daylio_event`
produce visible label cards.

## Testing

Tests are written with [Vitest](https://vitest.dev) and live in `tests/`.

### How the test suite is structured

The plugin can't run a full Obsidian runtime in CI, so the test strategy is:

1. **Unit tests** import exported pure functions via `src/main.ts` (which
   re-exports from the individual modules). The `obsidian` package import is
   intercepted by the alias in `vitest.config.ts` and redirected to
   `tests/__mocks__/obsidian.ts` — a minimal stub that satisfies the
   TypeScript compiler without needing a real Obsidian runtime.

2. **Integration tests** read the actual files in `daylio_plugin_test_vault/`
   (the real CSV and the real markdown notes) using Node.js `fs`. A helper
   (`tests/helpers/vault-reader.ts`) mirrors the logic of `scanVaultEvents` on
   plain filesystem paths, so the integration tests can verify end-to-end
   behaviour without mocking.

### What is and isn't tested

| Covered | Not covered |
|---|---|
| CSV parsing (all five moods, edge cases, CRLF) | SVG/DOM rendering (`buildGraphSvg`) |
| `groupByDay` ordering and grouping | Obsidian-specific UI (ribbon, command palette) |
| `scanVaultEvents` with mocked App | Settings tab rendering |
| Frontmatter extraction (quoted, unquoted, empty) | Plugin load/unload lifecycle |
| `scanDir` filtering | |
| Vault event detection against real test-vault files | |
| Known anchor points in the real CSV (mood counts, dates) | |

The DOM-dependent code is not tested here because it requires a real browser
environment. Manual testing in the test vault (open in Obsidian, Ctrl+R) covers
that layer.

### Testability convention

All pure functions are exported from their respective modules and re-exported
from `src/main.ts` so test files can import them via a single path. The
Obsidian classes (`Plugin`, `ItemView`, etc.) are NOT exported — they're only
needed by the Obsidian runtime, not by tests.

If you add a new pure function, export it from its module and add it to the
re-exports in `src/main.ts`. If you add logic that depends on the Obsidian
API, test it through the mock-App pattern in
`tests/unit/vault-scanner.test.ts`.

## CSS conventions

All CSS lives in `styles.css`. Classes are prefixed `daylio-` to avoid
collisions. Colours use Obsidian CSS variables (`--text-muted`,
`--interactive-accent`, etc.) so the plugin respects the user's chosen theme
automatically.

View-scoped rules that override Obsidian's own chrome use the attribute
selector `[data-type="daylio-mood-graph-view"]` — the value must match
`VIEW_TYPE_DAYLIO` exactly (not the plugin's manifest `id`).

Notable classes:

| Class | Purpose |
|---|---|
| `.daylio-graph-root` | Flex-column root; `position: relative` anchors the legend overlay |
| `.daylio-graph-scroll` | Horizontally scrollable SVG container; `flex: 1` fills remaining height |
| `.daylio-graph-legend` | `position: absolute; bottom/right` overlay in the graph corner |
| `.daylio-month-line` | Dashed vertical separator at each month boundary |
| `.daylio-year-line` | Slightly bolder dashed separator at each year boundary |
| `.daylio-entry-group` | `<g>` wrapping span background + per-day overlays for one vault entry |
| `.daylio-range-bg` | Faint full-span background rect, revealed on group hover |
| `.daylio-day-overlay` | Per-day transparent hit target; shown more prominently on direct hover |

## Graph rendering performance

The graph builder (`src/graph-builder.ts`) is optimised for fast zoom redraws:

- Mood bars are rendered as one `<path>` per mood level (5 total) instead of
  individual `<rect>` elements per bar (~2 900 rects → 5 paths).
- Lane dividers are a single `<path>` with multiple `M…H…` subpaths.
- Month separator lines use one `<path>`; year separator lines use a second
  `<path>` with a distinct CSS class.
- Event connector lines and label `<foreignObject>` elements are rendered in
  two passes so labels always sit in front of crossing connectors.
- A helper function `svgEl()` reduces boilerplate for element creation.
- The graph view caches parsed CSV data (`cachedDays`) and vault events so
  zoom redraws skip the async file read and directly call `buildGraphSvg()`.

## Releasing

The files Obsidian needs are `build/main.js`, `build/main.js.map`,
`manifest.json`, and `styles.css`. When publishing a new version:

1. Bump `version` in `manifest.json` (and `package.json`).
2. Run `npm run build`.
3. Create a GitHub release tagged with the version number (e.g. `1.0.0`).
4. Attach `build/main.js`, `build/main.js.map`, `manifest.json`, and
   `styles.css` as release assets.
