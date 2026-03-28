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

Vault events appear as small labelled cards above the graph, connected to
their date by a dashed line and a diamond marker. Clicking a card opens the
corresponding note.

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

In the Daylio app: More → Export → Export to CSV. Move the resulting file
into your vault — `attachments/daylio_export.csv` is a reasonable location.

### 2. Tell the plugin where the CSV is

Settings → Daylio Mood Graph → **CSV file path**. Enter the path relative
to your vault root, e.g.:

```
attachments/daylio_export.csv
```

### 3. Open the graph

Click the bar-chart icon (📊) in the left ribbon, or run the command
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
| CSV file path | Path to the Daylio export, relative to vault root | *(empty)* |
| Mood colours | A colour picker for each of the five mood levels | Daylio palette |
| Reset colours | Restores the default Daylio colour palette | — |

The time range (1 Mo / 2 Mo / 3 Mo / 6 Mo / 1 Year) is toggled directly
on the graph toolbar and persists between sessions.

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

See [CLAUDE.md](./CLAUDE.md) for build instructions, project structure, and
architecture notes.

## Licence

MIT
