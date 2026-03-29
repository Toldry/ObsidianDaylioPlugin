# Daylio Mood Graph — Obsidian Plugin

Renders your [Daylio](https://daylio.app) mood history as a colour-coded
graph inside Obsidian. Notes in your vault can annotate the graph with
labelled, clickable markers at the dates they correspond to.

## What it looks like

Each day in your Daylio export becomes a vertical bar. The bar is split into
segments — one per mood entry that day — each coloured by mood level. Days
with no entry are simply absent. Month boundaries are marked with dashed
lines and labels. The graph scrolls horizontally and defaults to showing the
most recent data.

```
rad   ████
good  ████ ████ ████
meh   ████ ████ ████ ████
bad        ████
awful
      ─────────────────────→ time
      Jun       Jul       Aug
```

Vault events appear as small labelled cards below the graph, connected to
their date by a dashed connector line. Clicking a card opens the
corresponding note. Hovering over a day column shows the date; hovering
over an event's range highlights the full period that event spans.

## Installation

### From the Community Plugin browser (once published)

1. Open Obsidian → Settings → Community Plugins → Browse.
2. Search for **Daylio Mood Graph** and install.
3. Enable the plugin.

### Manual installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the latest
   [GitHub release](../../releases/latest).
2. Copy them into your vault at:
   `.obsidian/plugins/daylio-mood-graph/`
3. In Obsidian: Settings → Community Plugins → enable **Daylio Mood Graph**.

## Setup

### 1. Export your data from Daylio

In the Daylio app: **More → Export Entries → CSV (table)**. 
Move the resulting file into your vault — `attachments/daylio_export.csv` is a reasonable location.

### 2. Tell the plugin where the CSV is

Settings → Daylio Mood Graph → **CSV file path**. Enter the path relative
to your vault root, e.g.:

```
attachments/daylio_export.csv
```

### 3. Open the graph

Click the smiley-face icon in the left ribbon, or run the command
**Daylio Mood Graph: Open Daylio Mood Graph** from the command palette
(Ctrl+P / Cmd+P).

## Annotating the graph with vault events

Any note whose filename begins with a `YYYY-MM-DD` date can place a labelled
marker on the graph for that date. Add a `daylio_event` field to the note's
YAML frontmatter:

```yaml
---
daylio_event: "Began university"
---

First day of term. The campus is larger than expected...
```

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

## Settings

| Setting | Description | Default |
|---|---|---|
| CSV file path | Dropdown listing all CSV files in your vault | *(empty)* |
| Mood colours | A colour picker for each of the five mood levels | Daylio palette |
| Reset colours | Restores the default Daylio colour palette | — |

The zoom level is controlled by a slider on the graph toolbar and persists
between sessions. Drag it left for an overview of years, right to zoom into
individual days.

## Mood levels and default colours

| Level | Default colour |
|---|---|
| Rad | `#f78c1e` (orange) |
| Good | `#41a766` (green) |
| Meh | `#9056a3` (purple) |
| Bad | `#5579a7` (blue) |
| Awful | `#6a777c` (grey) |

All colours are customisable in settings and respect your Obsidian theme for
surrounding UI elements.

## Compatibility

- **Minimum Obsidian version:** 0.15.0
- **Platforms:** desktop and mobile

## Development

### Building

```bash
npm install          # first time only
npm run dev          # watch mode with source maps
npm run build        # production bundle (type-checks first)
```

After building, copy `main.js`, `manifest.json`, and `styles.css` into your
vault's plugin folder and reload Obsidian (Ctrl+R / Cmd+R).

### Running the tests

The test suite uses [Vitest](https://vitest.dev) and requires no Obsidian
runtime — the Obsidian API is replaced by a minimal stub for unit tests, and
the integration tests read real files directly from `daylio_plugin_test_vault/`.

```bash
npm test                # run all tests once (unit + integration)
npm run test:watch      # re-run on every file save
npm run test:coverage   # run with coverage report
```

#### Test structure

```
tests/
├── unit/
│   ├── csv-parser.test.ts      isMoodLevel, parseCsvLine,
│   │                           parseDaylioCsv, groupByDay
│   └── vault-scanner.test.ts   scanVaultEvents (with mock App)
├── integration/
│   └── test-vault.test.ts      real CSV and real vault notes
└── helpers/
    └── vault-reader.ts         filesystem helper used by integration tests
```

Unit tests cover the CSV parser and vault scanner logic using a mock Obsidian
`App` object. Integration tests read `daylio_plugin_test_vault/attachments/daylio_export.csv`
and all the `.md` notes in `daylio_plugin_test_vault/` to verify end-to-end
behaviour against real data, including specific anchor points (known entry
counts, dates, and mood distributions).

The SVG rendering inside `buildGraphSvg` is not covered by automated tests
as it depends on a live browser DOM; test it manually by opening the test
vault in Obsidian.

See [CLAUDE.md](./CLAUDE.md) for full architecture and testability
conventions.

## Licence

MIT — open-source software. Use it, fork it, and contribute back freely.
