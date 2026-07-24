# Contributing

Thanks for contributing to WebdriverIO DevTools! This guide gets you from a clone to a reviewable PR.

## Prerequisites

- **Node.js** ≥ 20
- **pnpm** ≥ 9 (this is a pnpm workspace / monorepo)

## Setup

[**Fork**](https://github.com/webdriverio/devtools/fork) the repo on GitHub, then clone your fork and add the upstream remote:

```bash
git clone https://github.com/<your-username>/devtools
cd devtools
git remote add upstream https://github.com/webdriverio/devtools

pnpm install
pnpm build
```

You'll push branches to **your fork** (`origin`) and open pull requests against `webdriverio/devtools`. Keep your fork current with:

```bash
git fetch upstream && git rebase upstream/main
```

> Maintainers with write access to `webdriverio/devtools` can clone it directly and skip the fork.

## Development workflow

Run from the repo root:

| Command | What it does |
|---|---|
| `pnpm build` | Build all packages (`pnpm -r build`). |
| `pnpm dev` | Run all packages in parallel dev/watch mode. |
| `pnpm test` | Run the vitest suite once. |
| `pnpm test:watch` | vitest in watch mode. |
| `pnpm test:coverage` | vitest with coverage — the thresholds in `vitest.config.ts` are the floor; drops fail CI. |
| `pnpm lint` | Lint all packages. |
| `pnpm demo:wdio` / `:nightwatch` / `:selenium` | Run a per-framework example project — the harness for manual UI/runtime verification. |

Type-checks and unit tests verify code correctness, not feature correctness — for any UI or runtime change, verify it in `examples/<framework>/`.

## Where does my change go?

Read **[ARCHITECTURE.md](./ARCHITECTURE.md)** for the package map and the full decision tree. The short version:

- **Shared type / constant / contract** → `packages/shared`
- **Framework-agnostic capture / reporting logic** → `packages/core`
- **Framework-specific glue** → the matching adapter (`service` = WebdriverIO, `selenium-devtools`, `nightwatch-devtools`)
- **Server route / WS handler** → `packages/backend` (define the contract in `shared` first)
- **UI** → `packages/app`
- **Code that runs in the page under test** → `packages/script`

Resolving question: *who else would want this?* If "any future adapter would," it's `core`. If "only this framework's API needs it," it's the adapter. **Any change that would otherwise land in two or more adapters belongs in `core`.**

## Conventions

**[CLAUDE.md](./CLAUDE.md)** is the source of truth for how code is written here — single source of truth per concept, thin/isolated adapters, typed boundaries (no `any` across a package boundary), naming, file/function size, and comment style. Please skim it before your first PR; the linter enforces some of it, but not all.

## Tests

- `shared` and `core`: unit-test every exported function and type guard.
- Bug fixes: add a regression test that fails before the fix and passes after. If a real test is genuinely impossible (needs a live browser the CI lacks), say so in the PR description.
- New HTTP/WS contracts: exercise the contract end-to-end at least once.
- Coverage only ratchets upward — never lower the thresholds.

## Changesets

This repo publishes with [changesets](https://github.com/changesets/changesets). If your change affects a published package, add one:

```bash
pnpm changeset
```

Pick the bumped packages and a semver level, and commit the generated file with your change.

## Before you push

- `pnpm build`, `pnpm test`, and `pnpm lint` all green — don't push red.
- UI / runtime changes verified in `examples/<framework>/`.
- User-facing changes (a new option, CLI, flag, output, or workflow) update the relevant README **and** are mirrored to the [WebdriverIO devtools webpage](https://webdriver.io/docs/devtools) in the same change.

## Pull requests

- **One concern per PR** — a refactor and a feature are two PRs.
- Commit messages in imperative mood; the message explains *why*, the diff shows *what*.
- A PR that touches more than one adapter package answers in its description: *why isn't this in `core`?*
- Don't use `--no-verify` to skip hooks — if a hook fails, fix the underlying issue.

## License

By contributing, you agree that your contributions are licensed under the project's [MIT License](./LICENSE).
