---
'@wdio/devtools-service': patch
'@wdio/selenium-devtools': patch
'@wdio/nightwatch-devtools': patch
---

Trace mode no longer takes a page capture (screenshot plus page source, and DOM on web) for read and wait commands such as `getText`, `isDisplayed` or `waitForDisplayed`. Those rows still appear in the trace and now show the page as of the last command that changed it. Each capture costs a full page-source round trip, which on iOS is slow enough that a suite making a dozen interactions spent most of its time capturing reads: one reported run went from 3:10 to 7:10 in trace mode. The first traced command of each test is still captured even when it is a read, so a test that starts by reading has a frame to show (on Nightwatch's `describe`/`it` interface, the first of each module).
