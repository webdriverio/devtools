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

## Size budget

Every query is bounded by characters, as a stand-in for tokens, through one rule:

- `pageOf(items, { maxChars, cursor })` returns the items whose serialized length fits the budget (20000 characters unless `maxChars` says otherwise), and a `nextCursor` while items remain. A page always holds at least one item, so paging advances; an item larger than the budget comes back whole, which is why a query cuts its long fields first.
- A cursor is valid only for the query that returned it. One handed to a different listing is refused.
- `truncateText(text, maxChars)` cuts a single value to the budget in UTF-16 code units, never inside a surrogate pair, and says how long it was.

## Data handling

A trace holds everything the run typed and displayed. Whatever a caller passes on from it, for example to an AI provider, leaves the machine.
