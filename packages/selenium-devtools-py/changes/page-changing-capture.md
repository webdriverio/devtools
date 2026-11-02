---
patch
---

Trace mode reads each page's element tree after every command except known reads, waits and lookups, instead of only after a fixed list of page-changing commands, so a script run through the driver or an `actions` chain shows the page it changed. When reads follow a test's last capture, the test's end takes one more capture, stamped at that last capture and superseding it; the capture adds no command row. Reads and waits keep their own rows and show the tree from the last capture before them. Every command that returns still takes its screenshot, so a read saves only its element-tree read.
