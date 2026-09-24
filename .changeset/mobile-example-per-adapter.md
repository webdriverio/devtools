---
"@wdio/selenium-devtools": patch
"@wdio/nightwatch-devtools": patch
---

Add a mobile example per adapter — `pnpm demo:wdio:mobile`, `demo:selenium:mobile`, `demo:nightwatch:mobile`, `demo:python:mobile` — each honouring the same `DEVTOOLS_MODE=live|trace` switch the desktop demos already read.

All four build the same capability bag — spelled per language, which is a duplication worth collapsing — so a difference in the dashboard between two adapters is a difference in the adapter rather than in the test. `examples/MOBILE.md` is the one place the prerequisites and switches are stated.

The default target is the device's **own Clock app** (`com.google.android.deskclock`), which is what makes this landable at all: a native example previously needed an uploaded app and credentials in the environment, and that is the reason #354 closed without one. Nothing here needs an `.apk`. `APPIUM_APP` points it at a real app, and `DEVTOOLS_MOBILE=web` drives Chrome on the same device instead — worth running too, because a mobile browser session has a document and must keep every page-side call a native one skips.

All four drive the same flow on the timer SETUP screen — clear the entry, key a duration on the keypad, read it back, correct it with backspace — and none of them starts a timer. A running timer survives the session and replaces that screen with its card, so a spec that starts one is re-runnable only if it also finishes. They avoid the preset chips for the same class of reason: those are recently-used-duration suggestions, absent on a freshly reset Clock, so a preset-based flow fails on any device without timer history. Verified on an Android 16 emulator with Clock 9.1, from a reset app; the Clock app updates independently of the Android version, so the resource-ids are re-read rather than assumed.

Each one checks the toolchain before opening a session, through a shared `examples/mobile-preflight.cjs`, because none of the four frameworks reports a missing Appium in a way that names the cause: WDIO says "make sure browser driver is running", Nightwatch says it could not reach GeckoDriver, selenium-webdriver gives `ECONNREFUSED` and a stack trace. The check also distinguishes a missing Appium from a missing SDK from an emulator that is simply not started.

Two framework details are worth recording, since both fail in ways that do not point at them. selenium-webdriver's `Builder.build()` throws unless `browserName` is a **string**, before it ever contacts the server, so a native session needs `browserName: ''` — which is the W3C signal for "no browser" anyway. And Nightwatch needs `selenium.use_appium`, not merely a `webdriver` block pointed at port 4723; without it it infers GeckoDriver, and even once connected it fills in `browserName: "firefox"` plus `moz:firefoxOptions` unless the capability is explicitly `null` — measured on the wire, and it made the adapters treat an app session as having a document.

No adapter code changed: the dashboard already starts itself from `ensureBackendStarted()` and Python's `enable()`, so unlike the throwaway harnesses these replace, none of these examples needs a backend started by hand.
