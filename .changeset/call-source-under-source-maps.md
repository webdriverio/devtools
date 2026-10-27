---
'@wdio/selenium-devtools': patch
'@wdio/nightwatch-devtools': patch
'@wdio/devtools-service': patch
---

A command's source location no longer points into the adapter's own sources when the run has source maps enabled (for example under `tsx`) inside the devtools workspace; it names the test file again. A command with no user call site now carries no `callSource` instead of the `unknown:0` placeholder, and a malformed stack frame can no longer throw out of call-site detection.
