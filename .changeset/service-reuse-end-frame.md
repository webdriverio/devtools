---
'@wdio/devtools-service': patch
---

In trace mode, a test's first command no longer reads the page again when only lookups and reads ran since the previous test's end-of-test capture; it reuses that capture's frame. A wait, an `execute`, any other command, a session reload, or an end frame without a screenshot still triggers a new capture. On a native iOS session this saves one page-source read (about 0.6 to 0.8 s) for every test after the first.
