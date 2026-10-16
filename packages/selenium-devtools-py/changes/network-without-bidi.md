---
minor
---

Capture network requests on sessions without WebDriver BiDi: Safari, and every session Appium serves. Network capture subscribed through BiDi alone, so those sessions showed an empty Network tab. The page collector the adapter already injects for DOM replay now supplies the tab instead: its `fetch` / `XMLHttpRequest` patch, with headers, status and bodies for the calls the page makes, and the document's Resource Timing buffer, with every load the browser made and its timing and size. Resource Timing exposes no headers or bodies, and on Safari no status; the dashboard names that limit on each such request rather than showing it as failed. When BiDi is serving the session, the page's entries are withheld so each request is listed once. Serving means delivering: Appium's BiDi shim accepts the subscription and then sends no event, so the page's entries are withheld only once a BiDi request event has actually arrived.

A request the browser gives up on (a blocked beacon, a refused connection) is closed as a failure with the browser's own reason, where it used to stay pending for the rest of the session.

A session whose `webSocketUrl` capability is not a socket address (safaridriver echoes the requested `true` back) is no longer treated as BiDi-capable; previously selenium's own connection thread crashed on it.
