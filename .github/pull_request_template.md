<!--
This template encodes the rules in CLAUDE.md and ARCHITECTURE.md.
Delete sections that genuinely don't apply, but don't delete sections to avoid answering them.
-->

## What

<!-- One or two sentences. What does this PR change? -->

## Why

<!-- The motivation. Not "what" again — the reason this change exists. Link issue if any. -->

## How

<!-- The approach. Anything non-obvious about the implementation. -->

---

## Architecture self-check

> Required for every non-trivial PR. If a box is unchecked, explain why.

- [ ] **No new duplication.** This PR does not add a type, constant, enum, or contract that already exists in another package. (If it consolidates one, note which item from `CLAUDE.md` §7 is being resolved.)
- [ ] **No cross-adapter imports.** No code in `service`, `nightwatch-devtools`, or `selenium-devtools` imports from another adapter.
- [ ] **No adapter imports in `backend` / `app`.** Neither package reaches into adapter internals.
- [ ] **Typed contracts at boundaries.** Any new `fetch(...)`, `ws.send(...)`, or HTTP route has a typed request/response shape in `shared` (or in `service` types if `shared` doesn't exist yet, with a TODO to move).
- [ ] **No `if (framework === '...')` outside an adapter.** Framework branching uses a typed `FrameworkId`.
- [ ] **No new `any` at package boundaries.** Internal `any` is acceptable only at a documented framework-edge with a one-line comment.

### Multi-adapter changes

- [ ] This PR touches **more than one** adapter package.

> If checked: **why isn't this in `core`?** Answer here:
>
> _<your answer>_

---

## Debt scoreboard

> List the `CLAUDE.md` §7 debt items this PR resolves, partially resolves, or extends. Delete this section only if the PR genuinely affects no debt items.

- Resolved: _<item, or "none">_
- Partially resolved: _<item, or "none">_
- New debt introduced: _<item, or "none — and explain why if any>_

If new debt is introduced, it must be added to `CLAUDE.md` §7 in this PR.

---

## Testing

- [ ] Unit tests for new logic in `shared` / `core` (required per `CLAUDE.md` §4).
- [ ] Regression test for any bug fix (required per `CLAUDE.md` §4).
- [ ] `pnpm build` passes.
- [ ] `pnpm test` passes.
- [ ] `pnpm lint` passes.
- [ ] For UI/runtime changes: verified in `example/` (or `example` for the framework I changed).

If any required item is skipped, say so here with the reason:

_<your note, or "n/a">_

---

## Screenshots / recordings (UI changes only)

<!-- Drop them in here. -->
