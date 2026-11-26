---
'@wdio/devtools-service': patch
---

A Cucumber scenario keeps its row in the dashboard when WebdriverIO reports no line for it. Its id no longer depends on the worker slot or on its position among the scenarios a run selected, so running it in another worker, with `--spec file:line`, a tag filter or a rerun from the dashboard updates the same row. A scenario outline example takes the line of its own row in the Examples table, also when the outline is not the first scenario of the file, when the outline's name contains placeholders, or when it runs alone; a scenario is found by its exact title, and a plain scenario no longer takes the Examples line of an outline below it.
