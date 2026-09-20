---
"@wdio/devtools-backend": patch
"@wdio/devtools-core": patch
"@wdio/devtools-service": patch
---

Take one DOM capture per action again. Trace mode had grown a second, eager post-action capture beside the pre-action one, with a `readyState` poll and a 250 ms pause on top to hide the fact that the eager one lands while the screen is still moving — so every action paid two captures, and on a native Appium session each capture is two serial round trips. Measured on the native example spec: 15 screenshots and 15 page-source reads against 8 and 8, and a 14.0–14.7 s test against 11.4 s, with the captured frames equivalent.

The pre-action capture is the one that was right: taken before the command is issued, it is the moment the driver is guaranteed idle, so an action's result is the next action's "before". Only the last action has no successor to hand its result to, so a settle survives in exactly that one place, and it is gated rather than timed — no navigation, no wait. The eager capture, the poll that patched it and the document tag it was built on are deleted. Two related fixes ride along: a row with no capture of its own now replays the latest state at or before it rather than the nearest in absolute distance, which could hand it its successor's; and the screencast poll keeps at most one screenshot outstanding, so it cannot queue ahead of the test's own commands on a serialised driver.
