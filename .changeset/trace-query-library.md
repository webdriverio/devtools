---
'@wdio/devtools-trace-query': minor
---

New package `@wdio/devtools-trace-query`, the library under `@wdio/mcp`'s trace tools. `openTraceSource` opens a devtools trace zip from any byte source, reading only the entries its payload is built from, and returns a handle the package's queries take. `pageOf` and `truncateText` bound every result by a character budget, with a cursor, valid only for the query that returned it, to page through the rest. It reads traces from every devtools adapter through the same reader the trace player uses.
