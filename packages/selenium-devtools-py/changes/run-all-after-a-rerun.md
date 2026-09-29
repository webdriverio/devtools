---
patch
---

Keep Run-all meaning "run everything" after a targeted rerun. A rerun child is invoked with one nodeid on its command line, and the launch command was derived from that invocation — so once you reran a single test, Run-all republished as "run that one test" and kept rerunning it alone, with the tree showing only the test that child collected. The backend now hands the original command down, and a rerun child publishes that instead of guessing from its own arguments.
