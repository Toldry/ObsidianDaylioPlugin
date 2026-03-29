---
daylio_event: "After CSV range"
---

This note's date (2025-12-31) is after the latest entry in the test
CSV (2025-04-01).  The scanner should still return it as a raw event, but
no DayData exists for this date so the graph builder would silently drop it.
