---
patch
---

The scripts that inject and drain the DOM collector and read a navigation's timings are now fetched from the backend once per run, so they are the same scripts the JS adapters run rather than copies kept in this package. A backend too old to serve them logs a warning and the run continues with DOM replay and navigation timings off.
