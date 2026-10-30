---
'@wdio/elements': patch
'@wdio/devtools-backend': patch
'@wdio/devtools-service': patch
'@wdio/nightwatch-devtools': patch
'@wdio/selenium-devtools': patch
---

The accessibility-tree and interactable-element scripts now share one copy of the accessible-name steps they had in common. Names, locators and every export are unchanged.
