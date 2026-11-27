---
'@wdio/devtools-trace-query': minor
---

Query a trace's console and network. `traceConsole` lists console and stdio lines filtered by level (error lines unless other levels are named, with every level counted), source, text and the time around an action; `traceNetwork` lists requests with method, status, timing and source, filtered by status kind, URL and the time around an action, with no headers or bodies; `traceNetworkRequest` returns one request's headers, and reads its response body from the zip only when asked. A request seen only through the page's Resource Timing buffer (Safari, Appium) reports its status as `unknown`, never as an error, with a note on what the browser did not expose. Every result, each page included, stays within its `maxChars` (1000 at least): a request's headers are listed while they fit, with a count of those left out, and its body takes what remains. Times are milliseconds after the trace started, and long text is cut with its full length stated.
