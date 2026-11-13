---
patch
---

The payload types follow the dashboard contract's new optional `hook` field on a test row, which marks a row that stands for a failed Cucumber hook. The adapter sends no such rows; this keeps its generated types in step with the shared contract.
