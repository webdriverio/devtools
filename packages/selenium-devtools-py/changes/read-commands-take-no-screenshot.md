---
patch
---

Trace mode takes a command's screenshot only when the command can change the page, as the JavaScript adapters do. A read, wait or lookup, such as `find_element`, `.text`, `is_displayed()`, `is_enabled()`, `current_url`, `title` or `get_attribute`, takes no screenshot, and its row shows the capture of the last command that took one; before, it skipped only the element-tree read and still took a screenshot. Each test's first command with a row in the trace is still captured, and a test whose last capture is followed by reads takes one more capture at its end, now on a native app too. Appium's `is_displayed()` (`isElementDisplayed`) and the Appium context, activity, keyboard, lock and app-state reads are now known reads as well. Live mode still takes a screenshot for every command row. On a native app or a browser without a pushed screencast, the trace's filmstrip gets one frame per captured command, so a read no longer adds a frame.
