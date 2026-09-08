---
"@wdio/devtools-service": minor
"@wdio/devtools-app": minor
"@wdio/selenium-devtools": minor
"@wdio/nightwatch-devtools": minor
"@wdio/devtools-backend": minor
---

Carry a native mobile session's viewport, capabilities and device into the trace. A native Appium session produced a zip claiming `viewport: 1280x720` and `browserName: chromium` — both the exporter's own fallbacks rather than anything measured. Three separate causes had to be fixed together, because none of them is useful alone.

The values were never read: the WDIO service skipped its metadata send entirely for a native session, because it resolves the viewport from `window.visualViewport` and a native app has no DOM. It now reads the window off the driver instead (`getWindowSize`, measured at 1080x2219 on a Pixel 7 — the window minus the navigation bar), and degrades to no viewport rather than failing the session if that read is refused.

Reading them would not have been enough: the capturer's `metadata` — the copy the exporter serializes — was only ever written by the page-side collector's payload, while `sendUpstream` merely transmits. A value resolved on the driver therefore reached a live dashboard and was dropped before the zip. `SessionCapturer.mergeMetadata` now stores as well as publishes, and merges rather than replaces so a later push naming only a url cannot wipe the device.

And there was nowhere in the zip to put the device: `browserName` is normalized to `chromium` for android/iOS, `platform` names the HOST OS, and the reader rebuilt capabilities as `{ browserName }` alone, so the device survived only as prose inside `title` and every consumer re-derived "was this a phone?" from a heuristic. A `DeviceInfo` type and a single `deviceFromCapabilities` reader now live in shared, the zip states it as a `device` extension field on `context-options` (the same pattern the existing `runner` field uses), and the trace reader narrows it back in and puts the platform back onto the rebuilt capabilities. The naming order is what real hardware requires: `appium:deviceName` then `deviceModel` then `deviceName`, rejecting any candidate that merely repeats the udid — a device cloud reports an Android serial as both `deviceName` and `udid` and the friendly name only in `deviceModel`, while iOS reports a friendly `deviceName` with `udid` separate.

Because the field is derived in the exporter from capabilities every adapter already sends, Selenium, Nightwatch and the Python adapter gain it with no adapter-side change. The viewport read is per-adapter and remains done only in the WDIO service; Selenium and Nightwatch set no viewport at all today, desktop or native, so their zips still take the exporter's fallback.

The Metadata tab shows it as a `Device` row (`iPhone 17 (ios 18.1)`), which is all that reads it for now; #347 is the consumer this unblocks, and is what will shape and label the player's frame.

Note on units, for anything tempted to size a captured image by this viewport: don't. It disagrees with the screenshot on both platforms — Android reports the window without the navigation bar (1080x2219 against a 1080x2400 shot) and iOS reports points rather than pixels (390x844 against 1170x2532). Fit by the image's own decoded dimensions.
