---
'@wdio/nightwatch-devtools': major
---

The dashboard window is now opened with `webdriverio` 10, a runtime dependency, whose own requirements put the minimum Node at 22.19. The `devtools` peer is dropped: WebdriverIO 10 removed that automation protocol, so the window is a plain Chrome WebDriver session instead.
