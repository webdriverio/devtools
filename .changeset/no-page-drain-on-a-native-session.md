---
"@wdio/devtools-service": patch
---

Stop draining a page that does not exist. `SessionCapturer.captureTrace` reads the page-side collector through `browser.execute`, and a native Appium session has no document to run it in — but only two of its four call sites asked whether the session was native. The other two, the drain before a page-transition command and the final drain at teardown, went to the device anyway. Measured on a Pixel 7: five failed round trips per run, each printing `Failed to capture trace: WebDriverError: Method is not implemented` at ERROR in the user's output.

The check now lives inside `captureTrace`, where the assumption it protects lives, so a call site cannot forget it — and the live-command drain's own copy is gone, leaving that predicate to decide only which commands warrant a drain. The one remaining call-site check stays because it also gates a performance read, which is a separate page-side call.

Selenium and Nightwatch have the same shape — their drains are page-side too, and neither adapter detects a native session at all — but neither claims native support today, so this is scoped to the WDIO service.
