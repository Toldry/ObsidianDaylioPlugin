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

# Production — type-checks first, then builds minified bundle with no source maps
npm run build

# Run the test suite once
npm test

# Run tests in watch mode (re-runs on file save)
npm run test:watch

# Run tests with coverage report
npm run test:coverage
```

`npm run dev` runs esbuild in watch mode. It does NOT auto-reload Obsidian;
after a change, press Ctrl+R (or Cmd+R) inside Obsidian to reload the app.

The compiled output is `main.js` in the project root. Obsidian loads this
file, not the TypeScript sources directly.

## Project structure

```
daylio-obsidian-plugin/
├── src/
│   └── main.ts                  ← All plugin logic (single-file architecture)
├── tests/
│   ├── __mocks__/
│   │   └── obsidian.ts          ← Minimal Obsidian API stub for unit tests
│   ├── helpers/
│   │   └── vault-reader.ts      ← Filesystem-based vault scanner for integration tests
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
│   └── *.md                     ← Test notes (event notes, edge cases)
├── manifest.json                ← Plugin metadata (id, name, minAppVersion)
├── package.json
├── tsconfig.json
├── vitest.config.ts             ← Test runner config (aliases obsidian → mock)
├── esbuild.config.mjs
├── styles.css                   ← All CSS (uses Obsidian CSS variables)
└── main.js                      ← Compiled output — do not edit by hand
```

## Architecture

Everything lives in `src/main.ts`. The file is organised into clearly
delimited sections:

- **Types** — `MoodLevel`, `MoodEntry`, `DayData`, `VaultEvent`
- **CSV parsing** — `parseDaylioCsv`, `parseCsvLine`, `groupByDay`
- **Vault event scanner** — `scanVaultEvents` (reads `app.metadataCache`)
- **Graph view** — `DaylioGraphView extends ItemView` (SVG rendered into an
  Obsidian leaf pane)
- **Settings tab** — `DaylioSettingTab extends PluginSettingTab`
- **Plugin entry point** — `DaylioGraphPlugin extends Plugin`

The graph is pure SVG built via `document.createElementNS`. Event labels
use `<foreignObject>` so they can contain a clickable, text-wrapping `<div>`.

## Key Obsidian API touchpoints

| What | API used |
|---|---|
| Reading vault files | `app.vault.read(file: TFile)` |
| Finding a file by path | `app.vault.getAbstractFileByPath(path)` |
| Reading frontmatter without opening files | `app.metadataCache.getFileCache(file)` |
| Opening a note | `app.workspace.getLeaf(false).openFile(file)` |
| Registering the view | `this.registerView(VIEW_TYPE, creator)` |
| Persisting settings | `this.loadData()` / `this.saveData(data)` |

## Installing the plugin into the test vault

After building, copy the three distributable files into the test vault's
plugin folder:

```bash
# Unix/macOS
cp main.js manifest.json styles.css \
  daylio_plugin_test_vault/.obsidian/plugins/daylio-mood-graph/

# PowerShell
Copy-Item main.js, manifest.json, styles.css `
  daylio_plugin_test_vault\.obsidian\plugins\daylio-mood-graph\
```

Then reload Obsidian (Ctrl+R / Cmd+R) while the test vault is open.

## Settings storage

Settings are persisted by Obsidian to
`.obsidian/plugins/daylio-mood-graph/data.json`. The schema is:

```jsonc
{
  "csvPath": "attachments/daylio_export.csv",  // relative to vault root
  "barWidth": 8,                               // pixels per bar column (2–24); controls zoom
  "moodColors": {
    "rad":   "#f78c1e",
    "good":  "#41a766",
    "meh":   "#9056a3",
    "bad":   "#5579a7",
    "awful": "#6a777c"
  }
}
```

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

## Testing

Tests are written with [Vitest](https://vitest.dev) and live in `tests/`.

### How the test suite is structured

The plugin can't run a full Obsidian runtime in CI, so the test strategy is:

1. **Unit tests** import the exported pure functions from `src/main.ts` directly.
   The `obsidian` package import is intercepted by the alias in `vitest.config.ts`
   and redirected to `tests/__mocks__/obsidian.ts` — a minimal stub that satisfies
   the TypeScript compiler without needing a real Obsidian runtime.

2. **Integration tests** read the actual files in `daylio_plugin_test_vault/`
   (the real CSV and the real markdown notes) using Node.js `fs`. A helper
   (`tests/helpers/vault-reader.ts`) mirrors the logic of `scanVaultEvents` on
   plain filesystem paths, so the integration tests can verify end-to-end
   behaviour without mocking.

### What is and isn't tested

| Covered | Not covered |
|---|---|
| CSV parsing (all five moods, edge cases, CRLF) | SVG/DOM rendering (`DaylioGraphView.renderGraph`) |
| `groupByDay` ordering and grouping | Obsidian-specific UI (ribbon, command palette) |
| `scanVaultEvents` with mocked App | Settings tab rendering |
| Frontmatter extraction (quoted, unquoted, empty) | Plugin load/unload lifecycle |
| Vault event detection against real test-vault files | |
| Known anchor points in the real CSV (mood counts, dates) | |

The DOM-dependent code is not tested here because it requires a real browser
environment. Manual testing in the test vault (open in Obsidian, Ctrl+R) covers
that layer.

### Testability convention

All pure functions in `src/main.ts` are exported with the `export` keyword so
test files can import them. The Obsidian classes (`Plugin`, `ItemView`, etc.)
are NOT exported — they're only needed by the Obsidian runtime, not by tests.

If you add a new pure function to `src/main.ts`, export it and add unit tests.
If you add logic that depends on the Obsidian API, test it through the
mock-App pattern in `tests/unit/vault-scanner.test.ts`.

## CSS conventions

All CSS lives in `styles.css`. Classes are prefixed `daylio-` to avoid
collisions. Colours use Obsidian CSS variables (`--text-muted`,
`--interactive-accent`, etc.) so the plugin respects the user's chosen theme
automatically.

## Releasing

The three files Obsidian needs are `main.js`, `manifest.json`, and
`styles.css`. When publishing a new version:

1. Bump `version` in `manifest.json` (and `package.json`).
2. Run `npm run build`.
3. Create a GitHub release tagged with the version number (e.g. `1.0.0`).
4. Attach `main.js`, `manifest.json`, and `styles.css` as release assets.
