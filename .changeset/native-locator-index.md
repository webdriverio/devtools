---
'@wdio/devtools-service': patch
'@wdio/selenium-devtools': patch
'@wdio/nightwatch-devtools': patch
'@wdio/elements': patch
---

Trace mode no longer slows iOS native tests down the way it did. Each action's snapshot builds element locators from the app's page source, and every uniqueness check scanned the whole document, so the cost grew with the square of the screen's size: 23.5 s for one snapshot of a 750 KB iOS page source. The page source is now indexed once per snapshot, which brings the same snapshot to under 0.3 s with identical locators. Android, whose page sources are smaller and flatter, gains too but was far less affected.
