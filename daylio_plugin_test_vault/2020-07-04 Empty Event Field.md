---
daylio_event: ""
---

This note has a `daylio_event` key but the value is an empty string. The plugin should skip it (the check is `eventValue.trim() === ""`).

Otherwise a blank label would appear floating on the graph.
