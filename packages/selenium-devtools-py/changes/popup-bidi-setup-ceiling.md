---
patch
---

On Chrome 156 and 157, outside Appium, the BiDi preload registration and the console and network subscriptions give up after 10 s instead of selenium's 30 s, and the session falls back as it does when BiDi is unavailable: the page collector is injected per document, and console and network come from the page. Those versions never answer a WebDriver BiDi command for a tab opened by `window.open()` (crbug 571161446, fixed in Chrome 158.0.8106.0); the first such timeout in a session logs a warning naming the bug. A registration that answers after its ceiling is removed again and registers no handler. Every other browser, and every Appium session, behaves as before. Popup flows need Chrome 155 or 158+ for full capture while the bug is live.
