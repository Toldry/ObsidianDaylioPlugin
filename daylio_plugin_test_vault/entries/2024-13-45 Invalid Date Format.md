---
daylio_event: "Should be ignored — invalid date"
---

This note has a `daylio_event` but the filename starts with an invalid date (month 13, day 45).

The plugin's regex will still match the YYYY-MM-DD prefix pattern, but when this date is used on the graph it will simply find no matching bar (since no mood entry exists for 2024-13-45). This tests graceful handling of dates that parse but have no mood data.
