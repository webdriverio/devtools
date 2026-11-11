---
'@wdio/devtools-service': patch
'@wdio/selenium-devtools': patch
'@wdio/nightwatch-devtools': patch
---

Without a CDP screencast (Safari, Appium), the `filmstrip` recorder no longer queues its screenshots in front of the test. It skips a poll while a command or a per-action capture holds the driver (polling anyway once the newest frame is three intervals old, so the longest gap is about three intervals plus one screenshot, but never during a click, typing or a capture), keeps each per-action capture's screenshot as a filmstrip frame, and skips the poll that would only repeat it. The interval and the filmstrip default are unchanged, and Chrome's CDP push mode is untouched. With `DEVTOOLS_CAPTURE_TIMING=1`, the report adds a `filmstrip recorder` line: the screenshots the recorder took and their time, the polls it skipped and why, and the capture screenshots it kept as frames.
