---
'@wdio/devtools-trace-query': minor
---

Add `traceSnapshot` and `traceScreenshot`: the accessibility tree with locators and the screenshot at an action, as the trace player shows them. An action that took no capture of its own shows the latest earlier one, each result says when its capture was taken and which action took it, and neither returns a capture from after the action. A snapshot can be scoped to the subtrees under a locator or a text and is paged within the character budget; a screenshot comes back as its stored bytes with its pixel size, the size to downscale it to before a model sees it, and roughly what that costs in tokens.
