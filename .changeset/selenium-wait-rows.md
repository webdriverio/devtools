---
'@wdio/selenium-devtools': patch
---

A `driver.wait()` is now one row in the Actions list and the trace, shown as soon as the wait starts and updated when it ends, with the commands its condition issued nested under it. A wait on `until.elementLocated` reads as `waitForExist` on its locator's selector and a wait on `until.elementIsVisible` as `waitForDisplayed` on the element's, so a timed-out element wait names the element it waited for; any other condition keeps its own description. A passing wait, which used to leave only its polls behind, now has a row too.
