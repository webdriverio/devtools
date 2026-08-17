---
"@wdio/nightwatch-devtools": patch
---

Replay the last field a test fills before it submits, and the page it navigates to. Two ordering faults met here. The post-command collector drain captures the outgoing page's field edits, and it has to reach the driver before the next queued command or those edits die with the document the submit navigates away from; it was issued last, behind the action-snapshot probes and the screenshot, so it took about 130 ms to complete when the navigation left it only 18 ms, and the password fill replayed as an empty box. The drain is now the first request issued when a DOM-mutating command completes, and runs ahead of the performance-log read inside `captureTrace`.

That alone lost the destination page, because nothing else was really anchoring it: `anchorAfterNavigation` waited for the collector to go MISSING, and under the document-start preload every document instruments itself, so that signal is permanently false. The destination had only ever been anchored by a drain slow enough to land after the navigation. It now waits for the document's own `performance.timeOrigin` to change, which is the same clock a DOM anchor is stamped with, so a replacement is detected whatever the latency and a same-URL re-navigation counts too. The destination anchor is also issued after the row's screenshot and DOM snapshot rather than ahead of them.
