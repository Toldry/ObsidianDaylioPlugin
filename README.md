# Daylio Mood Graph — Obsidian Plugin

[![Obsidian Community Plugin](https://img.shields.io/badge/Obsidian-Community_Plugin-purple?style=for-the-badge&logo=obsidian)](https://community.obsidian.md/plugins/daylio-mood-graph)
[![Download Demo Vault](https://img.shields.io/badge/Demo_Vault-Download_Example_Vault-purple?style=for-the-badge&logo=obsidian)](../../releases/tag/demo-vault)

An [Obsidian](https://obsidian.md/) plugin that renders [Daylio](https://daylio.net/) mood data as a color-coded graph, annotated with Obsidian vault entries.

## Table of Contents

- [Quick Start / Demo Vault](#quick-start--demo-vault)
- [Installation](#installation)
  - [From Community Plugins](#from-the-obsidian-community-plugins-directory)
  - [Manual Installation](#manual-installation)
- [Setup](#setup)
  - [1. Export data from Daylio](#1-export-data-from-daylio)
  - [2. Format filenames with ISO dates](#2-format-obsidian-archives-entries-filenames)
  - [3. Configure CSV path](#3-tell-the-plugin-where-the-csv-is)
  - [4. Open the graph](#4-open-the-graph)
- [Annotating the Graph with Vault Events](#annotating-the-graph-with-vault-events)
  - [Point Events](#1-point-events)
  - [Range Events](#2-range-events)
- [Development](#development)
  - [Building](#building)
  - [Running the tests](#running-the-tests)
- [Technical Details](#technical-details)

## Quick Start / Demo Vault

Try out the plugin with pre-populated sample data:

Download the **[Example Vault Zip](../../releases/download/demo-vault/obsidian-daylio-plugin-demo-vault.zip)**, extract it, and open it in Obsidian (the plugin is already installed and configured) to see a working graph with sample entries and event annotations out of the box.

![](screenshot.png)

## Installation

### From the Obsidian Community Plugin Hub

Follow the link: 

- https://community.obsidian.md/plugins/daylio-mood-graph


### Manual installation

1. Create a new directory named `daylio-mood-graph` at `<OBSIDIAN_VAULT_ROOT>/.obsidian/plugins/`
2. Download the files from the [latest release](../../releases/latest) and copy them into `<OBSIDIAN_VAULT_ROOT>/.obsidian/plugins/daylio-mood-graph` 
3. Open the Obsidian vault and go to **Settings → Community plugins** → enable **Daylio Mood Graph**.

## Setup

### 1. Export data from Daylio

In the Daylio app: **More → Export Entries → CSV (table)**.
Move the CSV file into the Obsidian vault.

 e.g. `<OBSIDIAN_VAULT_ROOT>/attachments/daylio_export_2026_08_19.csv`

### <a name="iso_date_filenames"></a> 2. Format Obsidian archive's entries' filenames
To associate entries with specific dates, the `.md` file names must begin with an ISO date, e.g:
```
2020-04-13 First Corona Lockdown.md
```

### 3. Tell the plugin where the CSV is

**Settings → Community plugins → Daylio Mood Graph → CSV file path**

### 4. Open the graph

Select the smiley-face icon <img src="src/daylio-face.svg" width="20" height="20" alt="Daylio icon" style="vertical-align: middle;"> in the left ribbon, or run the command
**Daylio Mood Graph: Open mood graph** from the command palette
(<kbd>Ctrl</kbd>+<kbd>P</kbd> / <kbd>Cmd</kbd>+<kbd>P</kbd>).

The graph opens as a horizontal split pane below the active note.

## Annotating the graph with vault events

Vault notes can annotate the graph in two ways: **Point Events** (single-date milestones) and **Range Events** (multi-day timeline spans).

1. Inside an Obsidian entry, press <kbd>Ctrl</kbd>+<kbd>;</kbd> (Windows/Linux) or <kbd>Cmd</kbd>+<kbd>;</kbd> (macOS) to add a note property, or run the command **Add file property** from the command palette (<kbd>Ctrl</kbd>+<kbd>P</kbd> / <kbd>Cmd</kbd>+<kbd>P</kbd>).
2. Set the property name to `daylio_event`.
3. Write the name of the event, and specify date range if needed:




### 1. Point Events
```yaml
---
daylio_event: "Began university"
---
```

By default, the date of the event will be [taken from the entry's filename](#iso_date_filenames). To override it, use the pipe `|` sytnax:

```yaml
---
daylio_event: "Began university | 2003-04-05"
---
```

Multiple point events can be specified in a single note using Obsidian's native List property:

```yaml
---
daylio_event:
  - "Got a cat"
  - "Got a dog"
  - "Got a ferret | 2026-08-20" 
---
```

### 2. Range Events

For multi-day events that span across a date range, use the inline pipe (`|`) and arrow (`->`) syntax:

```yaml
---
daylio_event: Summer Vacation | 2026-07-12 -> 2024-07-28
---
```

Point events and multiple range events can also be combined in list properties:

```yaml
---
daylio_event:
  - Got a cat
  - Summer Vacation | 2026-07-12 -> 2026-07-28
  - Ongoing Project | 2026-03-01 ->
---
```

An unspecified end-date is treated as an ongoing event.


## Development

### Building

```bash
npm install # first time only
npm run build
```

After building, copy `build/main.js`, `manifest.json`,
and `styles.css` into the Obsidian vault's plugin folder and reload Obsidian.

The shorthand `npm run update:test-vault` builds and copies in one step.

> [!TIP]
> **Developer Workflow Tip:** It is recommended to keybind Obsidian's built-in command **"Reload app without saving"** to a keyboard shortcut such as <kbd>Ctrl</kbd>+<kbd>R</kbd> (Windows/Linux) or <kbd>Cmd</kbd>+<kbd>R</kbd> (macOS) under **Settings → Hotkeys**. This enables a rapid development loop: run `npm run update:test-vault`, switch to Obsidian, and press <kbd>Ctrl</kbd>+<kbd>R</kbd> (or <kbd>Cmd</kbd>+<kbd>R</kbd>) to see changes instantly.

### Running the tests

The test suite uses [Vitest](https://vitest.dev) and requires no Obsidian
runtime — the Obsidian API is replaced by a minimal stub for unit tests, and
the integration tests read real files directly from `obsidian_daylio_plugin_test_vault/`.

---
## Technical Details

For in-depth details on the plugin's internal design, data flow, and module responsibilities, see the [Architecture section in AGENTS.md](AGENTS.md#architecture).