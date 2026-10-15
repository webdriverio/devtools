---
'@wdio/devtools-script': minor
'@wdio/devtools-service': minor
'@wdio/selenium-devtools': minor
'@wdio/nightwatch-devtools': minor
'@wdio/devtools-backend': patch
'@wdio/devtools-app': patch
---

Capture network requests on browsers without WebDriver BiDi: Safari, and every session Appium serves. Network capture rode on BiDi (or, in Nightwatch, Chrome's performance log), so those sessions showed an empty Network tab. The injected page collector now also reads the document's Resource Timing buffer, which every browser keeps: the document, scripts, styles, images and fonts, each with its timing phases and size, and on Chromium its status. It reads the buffer at install, so loads made before the collector existed are included, then observes. The collector's existing `fetch`/`XMLHttpRequest` patch keeps supplying headers, status and bodies for the calls the page makes, and a request both saw is listed once.

What Resource Timing cannot see is stated rather than left blank: the detail card of such a request names that this browser exposes no headers or body for it (and on Safari no status), a request with no status is coloured as unknown rather than as still in flight, the method column is a dash where the browser names none, and the trace's `trace.network` entry carries `_source: "resource-timing"` and the captured `_resourceType` so a reopened trace renders the same row rather than a failed request. When BiDi is serving a session, the Resource Timing rows are dropped at ingest, so Chrome sessions are unchanged. Serving means delivering, not subscribed: against Appium 3.7's XCUITest driver the BiDi inspectors attach and then send no event, so each adapter now counts BiDi as a source only once a network event has arrived (the Selenium adapter applies the same rule to its console gate). Nightwatch's performance log, which is read after the page is drained, now upgrades the page's row for each load in place with the headers and status it has, so a Chrome session lists each request once and a Safari or Appium session whose capabilities still name a performance log is not left with an empty tab. A native app session has no document and still has no network capture, because the driver exposes none.
