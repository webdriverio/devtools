---
"@wdio/devtools-app": patch
---

Rows in the test tree and the trace player's action list are a single line of uniform height, clipped to their panel instead of sizing it.

- A long test, suite, step or action name no longer makes its row taller than its neighbours, so a tree reads as one list rather than a stack of unrelated blocks.
- The test-tree panel keeps the width its drag handle is set to. A name too long for that width is clipped at the panel edge instead of widening the panel past the handle it is supposed to follow.
- Clicking a row reflows its full name over as many lines as it needs, and exactly one row is expanded at a time — clicking another folds the previous one.
- Nothing expands a row on its own: the action at the playhead, a failed step that auto-opened, and the running test the tree auto-selects all stay on one line.
