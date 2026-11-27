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

Each query takes the handle and returns plain JSON-safe data, apart from the image bytes `traceScreenshot` returns, and is synchronous apart from the two that read an entry from the zip on demand, `traceNetworkRequest` and `traceScreenshot`. Every time ends in `Ms` and counts milliseconds from the trace's start (`timeMs` for an instant, `startMs` and `durationMs` for a span). Fields with no value are left out, and long values (titles, selectors, arguments, results, messages, console lines, URLs, header values, bodies) are cut, ending in `… (cut, N chars)` within the length they were cut to.

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
| `traceErrors(handle, { maxChars?, cursor? })` | A page of failed top-level actions, steps that failed on their own (such as a failing hook), console errors and failed requests (status 0 or 400 and above, the requests `traceNetwork` lists as `error`), by `timeMs`: when the action or step started, the line was written or the request was issued. |
| `traceActions(handle, { status?, group?, fromMs?, toMs?, maxChars?, cursor? })` | A page of the top-level actions in the order they started, each with the first 20 rows it issued (a wait's polls) as `children` and `omittedChildren` counting the rest. `status: 'passed'` keeps a row that passed itself; `failed` and `retried` keep a row when it or one of its rows has that status. `group` takes the `callId` of a test from the summary, and `fromMs`/`toMs` keep the rows that ran at least partly inside the window. A row too large for a page sheds the rows it issued, then cuts its own title and error, so every page fits `maxChars`. |
| `traceActionDetail(handle, callId, { contextLines?, maxChars? })` | One action: its arguments and result as JSON, its error with a failed assertion's `expected` and `actual`, the test it ran in, the action that issued it and the first 20 it issued, its `callSite` and the `source` lines around it (3 on each side unless `contextLines`, up to 50, says otherwise), `>` marking the call. Source lines are dropped first (down to the call's own line, then that line too), and only then is each field cut, until the whole result fits `maxChars`. |
| `traceTranscript(handle, { maxChars?, cursor? })` | The zip's `transcript.md` a page of lines at a time, each line cut to fit a page, or `undefined` when the zip carries none. |
| `traceConsole(handle, { levels?, sources?, text?, action?, windowMs?, maxLineChars?, maxChars?, cursor? })` | A page of console and stdio lines by `timeMs`: the page's console (`source: 'browser'`), the test's output (`test`) and the runner's terminal (`terminal`), colour codes stripped. With no `levels` it lists error lines only; name the levels to list others, or pass `[]` for every line. `byLevel` counts the lines the other filters match at every level, so a default listing still says how many warnings and other lines there are. A line is cut at 1000 characters unless `maxLineChars` says otherwise, and further when the page leaves it less. A source outside the three is left out. |
| `traceNetwork(handle, { status?, url?, action?, windowMs?, maxChars?, cursor? })` | A page of requests by `startMs`, with `durationMs`, `method`, `status`, `statusKind`, `type` and `source`, never headers or bodies. `status` takes status kinds, and `url` a case-insensitive substring of the whole URL. A URL whose text starts with the main origin followed by `/`, `?` or `#` is listed without it, and the page's `origin` names it once; any other URL (credentials, an explicit port, a `blob:` prefix, another host) is listed whole, cut at 300 characters, or less when the page leaves a row less. `byStatus` counts the requests the other filters match by status kind. |
| `traceNetworkRequest(handle, id, { body?, maxBodyChars?, maxChars? })` | One request by the `id` the listing gave, within `maxChars`: first its URL with the origin, MIME type, size (a captured 0 included), measured phases (`timingsMs`) and, for a Resource Timing request, a `note` saying what the browser did not expose; then its headers while they fit, each value cut at 2000 characters or to what is left, with `omittedHeaders` counting those left out; then, with `body: true`, the response body, cut to what remains and never past `maxBodyChars` (20000 unless given). The body is one the HAR inlined, or one stored in the zip, read only then, and only when the zip declares its size and that size is within 4 MB. When no body comes back, including when the stored entry cannot be read, `bodyUnavailable` says why and the rest of the request is still returned. |
| `traceSnapshot(handle, callId, { locator?, text?, maxChars?, cursor? })` | A page of the accessibility tree's node lines at the action, an element's ending `→ <locator>`, from the DOM for a web page and from the page source for a native app, indented two spaces per depth from the shallowest line; `header` is the `[Page: ...]` line naming the page's title and url, or `[android]` / `[ios]`, and `capture` says which capture it is. `locator` (exactly as the tree writes it) and `text` (a role, name or purpose, ignoring case) keep only the subtrees under the nodes that match, with `matches` counting them, so a caller can ask for one form rather than the page. A line is cut at 1000 characters, and further when the page leaves it less. `undefined` when nothing was captured at or before the action. |
| `traceScreenshot(handle, callId, { maxEdge? })` | The stored image at the action (`bytes`, `mimeType`, `size`), not resized: `fit` is the size within `maxEdge` (1024 pixels unless given) to downscale it to before a model sees it, and `tokens` Anthropic's estimate of what Claude's API bills at that size (width x height / 750), about 660 for a 1600x757 desktop frame and 630 for a 1080x2400 phone frame. Unfitted, the API scales an image whose long edge exceeds 1568 pixels down first, so those frames would bill about 1550 and 1480. Resizing is left to the caller, which keeps an image library out of this package. When the image does not come back (no declared size, over the 16 MB read limit, unreadable, or not a PNG or JPEG), `unavailable` says why in its place. `undefined` when nothing was captured at or before the action. |

An action's `status` is left out when it passed. It is `failed` by the same rule the trace player and `@wdio/opentelemetry` use, or `retried` for a failed poll that the wait which issued it went on to pass, which is not an error. A failed wait is one error; its failed polls are under it in `traceActions` and named in its detail. Actions are ordered by start time, which the trace writer sets in the order the test issued them, so a Nightwatch assertion reported at the end of its test still sits where it ran. A `callId` is the id the trace player's links name (`#action=call@12`).

Each error names a `callId`: the failed action or step itself, or for a console line or request, the action last started at or before it; one before the first action names none. `firstError` is the first failed action, else the first step that failed on its own. In a trace that failed, nothing else is put in its place, so a console line or request is never offered as the cause; in one that did not, it is the first console error or failed request.

`traceConsole` and `traceNetwork` take `action` (a `callId`) and `windowMs` to keep what happened around one action: its own span, widened by `windowMs` on each side (2000 unless given); a request is kept when any part of it falls inside. An empty `levels`, `sources` or `status` list filters nothing. A console line reads the same in `traceErrors` and `traceConsole`: strings as they are, other values as compact JSON.

A request's `statusKind` is `ok`, `redirect`, `error`, `pending` or `unknown`, by the same rule the dashboard's Network tab colours it by, and `traceErrors` lists exactly the `error` ones. Status 0 is `error`: a transport failure, which usually carries the browser's reason in `statusText`, or, with no `statusText`, possibly a request that had not answered when the trace was written, since the trace records a missing status as 0. A request seen only through the page's Resource Timing buffer (`source: 'resource-timing'`, the only network source on Safari and Appium) has no headers or body and, outside Chromium, no status: it is `unknown`, never `error`.

`traceSnapshot` and `traceScreenshot` show the page as the trace player does: an action that took no capture of its own, such as a read or an assertion, shows the latest earlier one, and neither ever shows a capture from after the action. Their `capture` gives its `timeMs` and, when an action took it, that action's `callId` and `title`, with `own: false` when the asked action inherited it. In a trace a devtools adapter wrote, the screenshot is the same capture as the snapshot, read from that capture's own stored image whatever the filmstrip holds. Only an action no capture was recorded for, as in a trace another tool wrote, falls back to the latest screencast frame at or before it, which no action took, so its `capture` names none.

A zip keeps an error's message but not its stack, so `callSite` and `source` say where the test was. Every query reads the whole zip: one that holds several tests is not narrowed to one of them.

## Size budget

Every query is bounded by characters, as a stand-in for tokens, through one rule. A query refuses a `maxChars` below 1000 (`MIN_QUERY_CHARS`), the smallest budget every query's whole result is held within; from there up, a result never exceeds its `maxChars`.

- `pageOf(items, { maxChars, cursor }, { scope, size })` returns the items that fit the budget (20000 characters unless `maxChars` says otherwise), the page's own `{ items, total, nextCursor }` wrapper and separators included, and a `nextCursor` while items remain. A page always holds at least one item, so paging advances; an item larger than the budget comes back whole, which is why a query cuts its long fields first.
- A cursor is valid only for the listing that returned it: it carries the list's length and a fingerprint of the listing's `scope` (each query's filters), and one handed to a different listing is refused.
- A page that carries fields beside its items (`byLevel`, `byStatus`, `origin`) pays for them out of the same budget, and each item is cut to what the page leaves it, so every page, not only the first, fits.
- Two queries with the same filters in another order (`levels: ['log', 'error']` and `['error', 'log']`) share their cursors.
- `truncateText(text, maxChars)` cuts a single value to the budget in UTF-16 code units, never inside a surrogate pair, and says how long it was.

## Data handling

A trace holds everything the run typed and displayed. Whatever a caller passes on from it, for example to an AI provider, leaves the machine.

In `traceConsole`, `traceNetwork`, `traceNetworkRequest`, `traceSnapshot` and `traceScreenshot`, every text taken from the run or the page (console lines, URLs, the origin, methods, status texts, MIME types, header names and values, bodies, why a body or a screenshot is unavailable, and the accessibility tree's header and lines with their names and locators) passes through one internal function, told what kind of text it is and, for a header, its name, which is where redaction and the marking of untrusted data are to apply. A screenshot's pixels are the page as it was, typed values included. The other queries (`traceSummary`, `traceErrors`, `traceActions`, `traceActionDetail`, `traceTranscript`) do not route their text through it yet.
