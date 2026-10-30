---
'@wdio/devtools-app': patch
---

The hosted trace player reads a trace `.zip` in a Web Worker instead of on the page's main thread, so the tab no longer freezes while a large trace opens. While it works, the landing screen names the step it is on (reading the file, unpacking the archive, building the timeline) under a progress bar that does not claim a percentage. The worker loads from the player's own origin, within the existing content security policy. The live dashboard is unchanged.
