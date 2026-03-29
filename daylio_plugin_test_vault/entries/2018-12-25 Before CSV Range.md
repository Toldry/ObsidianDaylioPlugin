---
daylio_event: "Before CSV range"
---

This note's date (2018-12-25) is before the earliest entry in the test
CSV (2019-02-15).  The scanner should still return it as a raw event, but
no DayData exists for this date so the graph builder would silently drop it.
