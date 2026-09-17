---
"@wdio/devtools-service": patch
"@wdio/selenium-devtools": patch
"@wdio/nightwatch-devtools": patch
---

Publish the viewport from every adapter. Selenium and Nightwatch published none at all, so `trace.metadata.viewport` was absent for every trace either produced and the exporter fell back to a hard-coded 1280x720 in three places. That fallback is what the player lays the DOM-replay iframe out at, so **every** Selenium and Nightwatch trace was replayed at 1280x720 regardless of the window the run actually used. Not a mobile problem: a desktop run at 2560x1440 was framed just as wrongly, which is presumably why it went unnoticed — the proportions are plausible.

The read has one home now, `resolveViewport` in `core`, because all three JS adapters need it. Two probes, only one of which exists at a time: a page measures itself through `visualViewport` — the only read carrying the real scale and offsets — and a native app has no page to ask, so the device's own window is the only answer. `isNativeAppSession` settles which, so the branch was already decided.

Each adapter supplies its own probes, and the care is in how: Selenium reads through the **unpatched** `getDriverOriginals()` and Nightwatch over its raw WebDriver transport, because both implement these as ordinary commands — through the patched path every run would open with an `executeScript` or `getWindowRect` row of our own making, and Nightwatch's would additionally sit behind the command in flight on its own queue.

The script reads the `visualViewport` fields one by one rather than returning the object: it is a host object, and a driver that serializes it structurally hands back `{}`, which would read as a successful empty measurement rather than a failed one. A read that answers nothing usable omits the viewport rather than publishing a zero-sized one, and a failure degrades to no viewport rather than failing the session.

The Python adapter already published one, but only `width`/`height` from `innerWidth`/`innerHeight`, so it lost the scale and offsets the shared `Viewport` declares; it now takes the same `visualViewport` read as the others.

Also corrects the claim, in the comment that survived, that this field is metadata only. It is load-bearing geometry wherever there is a DOM to replay.
