---
'@wdio/selenium-devtools': patch
---

Stop logging `[screenshot] Failed` warnings when the driver quits. Each command row's screenshot is taken in the background, so the last commands' screenshots could still be in flight when `driver.quit()` stopped the session under them, which on an Appium session logged a warning per screenshot. Quit now waits a few seconds for the captures already in flight, and a screenshot that still reaches the quitting session is skipped quietly.
