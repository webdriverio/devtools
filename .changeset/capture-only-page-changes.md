---
'@wdio/devtools-service': patch
'@wdio/selenium-devtools': patch
'@wdio/nightwatch-devtools': patch
---

Trace mode no longer takes a page capture (screenshot plus page source, and DOM on web) for reads, waits and lookups such as `getText`, `isDisplayed`, `waitForDisplayed` or `findElement`. Those rows still appear in the trace and show the page as of the last command that took a capture (any command except reads, waits, lookups and asserts). Each capture costs a full page-source round trip, which on iOS is slow enough that a suite making a dozen interactions spent most of its time capturing reads: one reported run went from 3:10 to 7:10 in trace mode. The first traced command of each test is still captured even when it is a read, so a test that starts by reading has a frame to show (on Nightwatch's `describe`/`it` interface, the first of each module).

Selenium and Nightwatch now capture every other command, including ones that can navigate but are not in the action map (`executeScript`, `actions`, Nightwatch `submitForm`), and take one more capture at a test's end when reads follow its last capture, so a click that returns before its navigation commits no longer leaves the reads showing the page it left. The WDIO service keeps its page-changing gate.
