---
patch
---

Behaviour now matches the JavaScript adapters in four places. An assertion comparing a read value with an equal number of the other numeric type, such as `assert count == 3.0` after an element read returned `3`, now names that element. Command row ids now start at the process's base id rather than one past it. Two waits started from one helper with different anonymous conditions, such as two `lambda`s, are now told apart when one outer wait's polls switch between them, so their polls no longer fold into one row. A navigation whose page reports no resources or document info leaves those fields absent instead of reporting an empty list, a count of 0 and an empty document.

A navigation row's summary shows its load time in milliseconds to two decimals, such as `246.40 ms`, as the JavaScript adapters do.
