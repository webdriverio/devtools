---
'@wdio/elements': major
---

`getSnapshot` now produces the same text as `wdio session snapshot --selectors`, by delegating to `@wdio/snapshot` instead of keeping a second renderer that drifted from the CLI's. Agents that read the CLI's output and agents that call this function now see one format.

Breaking: it returns `{ text, refs }` rather than `{ text, elements }`, takes `{ viewport }` (default `false`, the full page) in place of `{ inViewportOnly }` (default `true`), no longer prefixes a `[Page: …]` header, and throws on failure instead of returning a placeholder. `serializeWebSnapshot`, `serializeMobileSnapshot` and their option and result types are removed. Requires `webdriverio` ^10.
