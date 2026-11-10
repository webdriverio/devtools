---
'@wdio/devtools-service': patch
---

In trace mode the Appium reads `isElementDisplayed`, `getContexts`, `getCurrentContext`, `getCurrentActivity`, `getCurrentPackage`, `isKeyboardShown`, `isLocked`, `queryAppState`, `isAppInstalled`, `getSettings` and `getStatus` no longer count as commands that change the screen. When one of them follows a test's last action, the end-of-test capture is named after that action rather than after the read, and the next action's capture is stamped at that action's end.
