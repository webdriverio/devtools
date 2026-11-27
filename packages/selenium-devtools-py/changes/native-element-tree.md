---
minor
---

On a native app, trace mode now records the element list and accessibility tree for each action that takes a capture, as the JavaScript adapters do, so the trace's A11y tab and element locators are filled where before the action carried a screenshot alone. The adapter reads the app's page source once per capture, without a command row of its own, and the backend turns it into the tree when it writes the trace; this needs a backend from the same release. `DEVTOOLS_A11Y=0` (or `a11y=False`) turns the read off. On XCUITest the page-source read costs about 0.75 to 1.2 s per capture, and on UiAutomator2 about 0.1 to 0.5 s; `DEVTOOLS_CAPTURE_TIMING=1` reports it as the `pageSource` probe.
