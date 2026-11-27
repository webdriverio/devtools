# @wdio/devtools-trace-query

Reads a devtools `trace.zip` one piece at a time, within a size budget, so a coding agent can debug a failed run from its trace without loading the whole archive. It is the library under the trace tools of [`@wdio/mcp`](https://github.com/webdriverio/mcp), and it reads traces written by every devtools adapter (WebdriverIO, Selenium, Nightwatch and Python) through the same reader the trace player uses.

## Opening a trace

```ts
import { openTrace } from '@wdio/devtools-trace-query'

const { handle, test } = await openTrace(
  'test-results',
  { allowedRoots: [process.cwd()] },
  { uid: testUid, specFile: 'specs/login.ts' }
)
```

`openTrace(location, options, target)` takes one of:

- **A zip.** It is opened whole.
- **A run's output folder.** With artifacts manifests (`devtools-artifacts-<sessionId>.json`) in it, the target picks the test: its `uid`, with its `specFile`, since tests with the same title share a uid, and with its `sessionId` when the same test ran on several browsers. The final attempt opens unless `attempt` names another. Without a target the error lists the folder's tests, failed first. A folder without a manifest, which is what the Python adapter writes, opens its only zip, or lists its zips when it holds several.
- **An https URL**, such as a span's `devtools.artifact.url`. It is opened whole.

When a target picks the test, `test` says which one opened, and `sharedZip` whether its zip also holds other tests or earlier attempts. A span carries everything a target needs: `devtools.test.uid`, `test.suite.name` (the spec file) and `session.id`.

The trace is opened on demand: only the entries its payload is built from are read, and screenshots, response bodies and page resources stay in the zip until a query needs one. The handle is what every query of this package takes; what it holds is not part of the API. `openTraceSource(source, { maxInflatedBytes })` opens bytes the caller already holds (`bytesZipSource(bytes)`); of the checks below, only `maxInflatedBytes` applies to it.

### Limits and safety

| Option | Default | Meaning |
|---|---|---|
| `allowedRoots` | none | Directories a local path must resolve inside, after symlinks and `..`. A zip a manifest names is checked the same way, a manifest is read only as a regular file in the folder, and a zip is read only while it is still the file that was checked. With none, local paths are refused. |
| `allowedHosts` | none | Hosts a URL may be fetched from: an exact name, or `*.example.com` for its subdomains, with `:port` for a port other than 443. Every redirect is checked again. With none, URLs are refused. |
| `allowPrivateNetwork` | `false` | Fetch from loopback, private, link-local and reserved addresses, including an IPv4 one carried inside IPv6 (NAT64, 6to4). Checked on an IP literal in the URL and on every address a name resolves to, on the connection's own lookup, so a DNS answer cannot point an allowed host at the local network. |
| `maxZipBytes` | 200 MiB | Largest zip opened, on disk or downloaded. |
| `maxInflatedBytes` | 256 MiB | Most the entries a payload is built from may declare inflating to. |

Only https URLs are fetched, on a connection of their own (no proxy, no pooled socket), within 5 minutes in all. A downloaded zip is held in memory, never written to disk. Messages name a URL without its query string, since a presigned URL carries its credentials there.

## Queries

Each query takes the handle and returns plain JSON-safe data. Every time ends in `Ms` and counts milliseconds from the trace's start (`timeMs` for an instant, `startMs` and `durationMs` for a span). Fields with no value are left out, and long values (titles, selectors, arguments, results, messages) are cut, ending in `… (cut, N chars)` within the length they were cut to.

```ts
import {
  traceActionDetail,
  traceErrors,
  traceSummary
} from '@wdio/devtools-trace-query'

const summary = traceSummary(handle)
const errors = traceErrors(handle)
const failed =
  summary.firstError?.kind === 'action' ? summary.firstError.callId : undefined
const detail = failed ? traceActionDetail(handle, failed) : undefined
```

| Function | Returns |
|---|---|
| `traceSummary(handle, { maxChars? })` | `runner`, `browser` or `device`, `durationMs`, `outcome`, `counts` of what `traceErrors` and `traceActions` list (top-level actions, failed actions, steps that failed on their own, console errors, failed requests), the `firstError` and `tests`, the suites, tests and steps the zip records with each one's `outcome`. When the tree takes more than half the budget, only its failed branches stay, as many as fit, and `omittedTests` counts the suites, tests and steps left out. A summary still over `maxChars` cuts the first error's text, then leaves the tree out. |
| `traceErrors(handle, { maxChars?, cursor? })` | A page of failed top-level actions, steps that failed on their own (such as a failing hook), console errors and failed requests (status 0 or 400 and above), by `timeMs`: when the action or step started, the line was written or the request was issued. |
| `traceActions(handle, { status?, group?, fromMs?, toMs?, maxChars?, cursor? })` | A page of the top-level actions in the order they started, each with the first 20 rows it issued (a wait's polls) as `children` and `omittedChildren` counting the rest. `status: 'passed'` keeps a row that passed itself; `failed` and `retried` keep a row when it or one of its rows has that status. `group` takes the `callId` of a test from the summary, and `fromMs`/`toMs` keep the rows that ran at least partly inside the window. A row too large for a page sheds the rows it issued, then cuts its own title and error, so every page fits `maxChars`. |
| `traceActionDetail(handle, callId, { contextLines?, maxChars? })` | One action: its arguments and result as JSON, its error with a failed assertion's `expected` and `actual`, the test it ran in, the action that issued it and the first 20 it issued, its `callSite` and the `source` lines around it (3 on each side unless `contextLines`, up to 50, says otherwise), `>` marking the call. Source lines are dropped first (down to the call's own line, then that line too), and only then is each field cut, until the whole result fits `maxChars`. |
| `traceTranscript(handle, { maxChars?, cursor? })` | The zip's `transcript.md` a page of lines at a time, each line cut to fit a page, or `undefined` when the zip carries none. |

An action's `status` is left out when it passed. It is `failed` by the same rule the trace player and `@wdio/opentelemetry` use, or `retried` for a failed poll that the wait which issued it went on to pass, which is not an error. A failed wait is one error; its failed polls are under it in `traceActions` and named in its detail. Actions are ordered by start time, which the trace writer sets in the order the test issued them, so a Nightwatch assertion reported at the end of its test still sits where it ran. A `callId` is the id the trace player's links name (`#action=call@12`).

Each error names a `callId`: the failed action or step itself, or for a console line or request, the action last started at or before it; one before the first action names none. `firstError` is the first failed action, else the first step that failed on its own. In a trace that failed, nothing else is put in its place, so a console line or request is never offered as the cause; in one that did not, it is the first console error or failed request.

A zip keeps an error's message but not its stack, so `callSite` and `source` say where the test was. Every query reads the whole zip: one that holds several tests is not narrowed to one of them.

## Size budget

Every query is bounded by characters, as a stand-in for tokens, through one rule. A query refuses a `maxChars` below 1000 (`MIN_QUERY_CHARS`), the smallest budget every query's whole result is held within; from there up, a result never exceeds its `maxChars`.


- `pageOf(items, { maxChars, cursor }, { scope, size })` returns the items that fit the budget (20000 characters unless `maxChars` says otherwise), the page's own `{ items, total, nextCursor }` wrapper and separators included, and a `nextCursor` while items remain. A page always holds at least one item, so paging advances; an item larger than the budget comes back whole, which is why a query cuts its long fields first.
- A cursor is valid only for the listing that returned it: it carries the list's length and a fingerprint of the listing's `scope` (each query's filters), and one handed to a different listing is refused.
- `truncateText(text, maxChars)` cuts a single value to the budget in UTF-16 code units, never inside a surrogate pair, and says how long it was.

## Data handling

A trace holds everything the run typed and displayed. Whatever a caller passes on from it, for example to an AI provider, leaves the machine.
