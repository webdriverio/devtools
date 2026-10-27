---
'@wdio/nightwatch-devtools': patch
'@wdio/selenium-devtools': patch
---

A command's late screenshot now updates only that command's row. In Nightwatch, an assertion that finished in the same millisecond as the read before it could be overwritten by the read's screenshot, so the dashboard and the trace showed the read twice and lost the assertion. Every Nightwatch row now carries its own id, a retried command keeps the id of the row it replaces, and a screenshot that arrives after its row was retried is dropped. Row ids are also numbered apart per process in both adapters, so a rerun started from the dashboard, or a parallel worker, cannot update a row another process recorded.
