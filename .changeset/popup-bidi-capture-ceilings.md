---
'@wdio/devtools-service': patch
'@wdio/selenium-devtools': patch
'@wdio/nightwatch-devtools': patch
---

On Chrome 156 and 157, a capture call that never answers no longer hangs the test. Those versions never answer a WebDriver BiDi command for a tab opened by `window.open()` (crbug 571161446, fixed in Chrome 158.0.8106.0). On those two versions, outside Appium, the BiDi preload registration and the console and network subscriptions give up after 10 s and the session falls back to per-document injection and the page's own console and network; a registration that answers later is removed again and registers nothing. In the WebdriverIO and Selenium adapters, a collector drain or injection gives up after 5 s and a screenshot, url or performance read after 4 s. A call that runs out is skipped and the test carries on, and the first one in a session logs a warning naming the bug. Capture keeps trying the popup, so while the test is on a hung popup each capture call aimed at it pays its ceiling. Every other browser, and every Appium session, waits on capture exactly as before. Popup flows need Chrome 155 or 158+ for full capture while the bug is live.
