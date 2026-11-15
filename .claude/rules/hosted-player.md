---
paths:
  - "packages/app/src/**"
  - "vercel.json"
  - "packages/shared/src/player-csp.ts"
  - "packages/conformance/hosted-player/**"
---

### Hosted player check

`ci.yml`'s `hosted-player` job runs `pnpm player:e2e`: it serves the hosted build under the `vercel.json` headers and, in headless Chrome, opens each committed older-format fixture and a zip written by this checkout's writer (`hosted-player/current-trace.ts`) through the landing screen's file input, expecting every manifest title as an action row, a filmstrip frame (an `<img>` whose source is a `blob:` URL read from the zip, or a `data:` URL) and no error, then the current-writer zip again by `?trace=` from the preview's own origin with a `#action=…&tab=network` link, expecting that action selected, the Network tab open and a later pick written back to the hash (skipped against a deployed player, which has no zip on its origin), then a non-zip, expecting `Could not open`. The served CSP must equal `hostedPlayerCsp()` directive for directive, so the check also catches a policy that drifted looser or stricter. It fails on any console error or uncaught exception the page logs over WebDriver BiDi, and on any CSP violation, which a preload script reports to the console because BiDi carries no CSP message of the browser's own; it also requires the parse worker's script to have been requested. Vercel deploys `main` to trace.webdriver.io and builds a preview for each PR, reporting both in PR comments rather than as GitHub deployments, so no workflow event marks a production deploy. `scheduled-hosted-player.yml` therefore runs the same check against the deployed player (`vars.HOSTED_PLAYER_URL`, `https://trace.webdriver.io` when unset) every six hours and on demand, and keeps one open issue for a failing check, closing it once it passes. A change to the landing screen, the action rows or the filmstrip that moves what `page-scripts.ts` reads updates it in the same PR.

Replay safety (from the app section, packages/app/CLAUDE.md):

- A trace is untrusted input; its replay runs no script in any mode.
- The replay iframe is sandboxed (`allow-same-origin` only); `components/browser/replay-safety.ts` drops `<script>`, `on*`, `srcdoc` and `javascript:` URLs on the first render and on every replayed mutation.
- The CSP in `shared/player-csp.ts` blocks what that misses. `vercel.json` sends `hostedPlayerCsp()`, which must differ from the backend's `playerCsp()` in `connect-src` alone; a test holds it to that.
- The hosted player downloads `?trace=<url>` only over https or the page's own origin; the hosted e2e check opens a hostile trace to prove no script runs.
