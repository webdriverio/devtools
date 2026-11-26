---
paths:
  - "packages/app/src/components/browser/replay-safety.ts"
  - "packages/app/src/components/browser/snapshot.ts"
  - "packages/app/src/components/browser/vnode-transform.ts"
  - "packages/app/src/controller/trace-link.ts"
  - "packages/app/src/controller/trace-open.ts"
  - "packages/app/src/utils/trace-link.ts"
  - "packages/app/src/components/onboarding/open-trace.ts"
  - "packages/app/src/components/workbench/actionItems/command.ts"
  - "packages/app/src/components/workbench/actionItems/group.ts"
  - "packages/app/src/components/tabs.ts"
  - "packages/app/src/components/browser/trace-timeline.ts"
  - "packages/shared/src/player-csp.ts"
  - "packages/conformance/hosted-player/**"
  - "vercel.json"
---

# Hosted trace player

Scope: the hosted build served under the `vercel.json` headers, and the `pnpm player:e2e` check that drives it.

## Rules

- Treat a trace as untrusted: the replay iframe is sandboxed `allow-same-origin` only, and `packages/app/src/components/browser/replay-safety.ts` strips `<script>`, `on*`, `srcdoc` and `javascript:` in `href`, `src`, `action`, `formaction` and `xlink:href` on first render and on every mutation. Why: a trace is attacker-controlled DOM replayed in the player.
- Keep the CSP in `vercel.json` equal to `hostedPlayerCsp()` (`packages/shared/src/player-csp.ts`), directive for directive; it differs from the backend's `playerCsp()` only in `connect-src` (`packages/conformance/tests/hosted-player-expectations.test.ts`). Why: the e2e check fails on drift in either direction, looser or stricter.
- A change to the landing screen, action rows, groups, filmstrip or tabs that moves what `packages/conformance/hosted-player/page-scripts.ts` reads updates it in the same PR. Why: the check reads the rendered DOM by element tag and selector, so a mismatch shows only when the e2e runs.
- `?trace=<url>` downloads fetch only https or the page's own origin (`trace-open.ts`). Why: a shared link must not make the player fetch an arbitrary origin.

## Accepted residuals

- No workflow event marks a production deploy, so `scheduled-hosted-player.yml` runs the same check against the deployed player every six hours.
