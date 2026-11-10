---
"@wdio/selenium-devtools": patch
"@wdio/nightwatch-devtools": patch
---

Capture the element list and accessibility tree per action on native Appium sessions. In trace mode each action of a native app now reads the app's page source beside its screenshot, as the WebdriverIO service does, so a native trace carries element data, locators and the A11y tab instead of a screenshot alone. The page source is the costly part of a native capture, most of it on iOS, and it shows as the `pageSource` probe in the `DEVTOOLS_CAPTURE_TIMING=1` report, which now marks these captures native.
