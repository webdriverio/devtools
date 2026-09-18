---
"@wdio/devtools-service": patch
"@wdio/devtools-app": patch
---

Make a live native mobile run visible on the dashboard. Three separate gaps left one looking empty, and each hid the next.

**Early messages were discarded in silence.** A session's metadata and its first suites are published while the driver is still being created — against Appium that is ~11 s before the worker socket opens — and `sendUpstream` dropped anything sent before the socket was open. `metadata.type` gates the test-suite pane and `metadata.device` gates the mobile layout, so a live run showed neither the test tree nor the device frame and simply looked like nothing had been captured. Messages published while the socket is CONNECTING are now buffered and flushed in publication order on open; a socket that dies before ever opening reports and releases what it held rather than retaining a run's worth of payloads. The buffer is bounded.

Drop reporting is re-entrancy guarded, because the fix uncovered a second trap: `patchConsole` forwards console output upstream, so an adapter's drop handler that logs re-enters `sendUpstream`, drops again and recurses until the stack blows — surfacing as `Maximum call stack size exceeded` raised inside the user's own spec, pointing nowhere near the capturer.

**A native command carried no image.** The per-command screenshot was skipped for every Appium session. A native session has no DOM to replay and no per-action snapshot outside trace mode, so the player had nothing to show for any command and the device pane fell back to desktop browser chrome. Native sessions now take one in **live mode only** — trace mode already screenshots the same command through `captureActionResult`, and two Appium round trips at ~1.2 s each is the cost #351 exists to remove. A mobile *browser* session is unchanged: it replays from its mutation stream.

**The capture had nowhere sensible to sit.** The trace player puts the dock beside the capture, which works when the whole window is the trace. A live dashboard has already spent its left edge on the suite tree, so a third column squeezed the dock into an unreadable strip and the tab row overflowed under the capture. Live mode now stacks the action list and the dock in one column beside a full-height capture, with both drag handles working and the collapse reversible.
