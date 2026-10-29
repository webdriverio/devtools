---
patch
---

An explicit `devtools_trace = false` now outranks a trace policy or granularity
that only implies trace mode at the same level or below, with the command line
(flags and `-o`) above the ini file. `pytest -o devtools_trace=false` therefore
gets a live dashboard from a project whose ini commits a policy, and the run
logs one warning naming the setting it left with nothing to do. A policy or
granularity left that way no longer opts the run in on its own.
