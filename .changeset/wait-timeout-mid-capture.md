---
'@wdio/devtools-service': patch
---

A wait that times out while the service is still capturing one of its polls (taking that row's screenshot, for example) now shows as failed with its timeout error. WebdriverIO skips every command hook while another is running, so the wait's own `afterCommand` never ran and its row stayed open with no error, as if it had passed; the poll's hook, still running when the test ended, could also swallow the next test's first command. At the end of each test, step or scenario the service now waits for its own command hooks to finish and closes any wait still open, with the test's outcome: its error if it failed (an assertion failure stays on the assertion's own row) or as passed if it did not.
