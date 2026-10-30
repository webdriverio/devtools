---
patch
---

Trace mode reads each page's element tree only after a command that changes the page, and after each test's first command, instead of after every command. Reads and waits keep their own rows and show the tree from the last page change.
