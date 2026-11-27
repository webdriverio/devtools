# @wdio/devtools-trace-query

Reads a devtools `trace.zip` one piece at a time, within a size budget, so a coding agent can debug a failed run from its trace without loading the whole archive. It is the library under the trace tools of [`@wdio/mcp`](https://github.com/webdriverio/mcp), and it reads traces written by every devtools adapter (WebdriverIO, Selenium, Nightwatch and Python) through the same reader the trace player uses.

## Usage

```ts
import { readFile } from "node:fs/promises";
import { bytesZipSource, openTraceSource } from "@wdio/devtools-trace-query";

const trace = await openTraceSource(
  bytesZipSource(await readFile("trace.zip")),
);
```

`openTraceSource` reads only the entries a trace's payload is built from; screenshots, response bodies and page resources stay in the zip until a query needs one. It returns a handle that every query of this package takes. What the handle holds is not part of the API.

## Size budget

Every query is bounded by characters, as a stand-in for tokens, through one rule:

- `pageOf(items, { maxChars, cursor })` returns the items whose serialized length fits the budget (20000 characters unless `maxChars` says otherwise), and a `nextCursor` while items remain. A page always holds at least one item, so paging advances; an item larger than the budget comes back whole, which is why a query cuts its long fields first.
- A cursor is valid only for the query that returned it. One handed to a different listing is refused.
- `truncateText(text, maxChars)` cuts a single value to the budget in UTF-16 code units, never inside a surrogate pair, and says how long it was.

## Data handling

A trace holds everything the run typed and displayed. Whatever a caller passes on from it, for example to an AI provider, leaves the machine.
