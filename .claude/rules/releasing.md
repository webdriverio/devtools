---
paths:
  - ".changeset/**"
  - "packages/selenium-devtools-py/**"
  - ".github/workflows/release.yml"
  - ".github/workflows/python.yml"
---

### Releasing a change

Two mechanisms, and the Python one exists because the npm one cannot reach it. Changesets discovers packages through the pnpm workspace and identifies them by `package.json`; `packages/selenium-devtools-py` is in neither, so a changeset naming `selenium-devtools-py` does not degrade — it raises "not in the workspace", fails `changeset version`, and takes the npm release for every other package down with it.

- **Published npm package changed** → `pnpm changeset`, committed as `.changeset/*.md`.
- **`packages/selenium-devtools-py/src/` changed** → a fragment under `packages/selenium-devtools-py/changes/`, frontmatter carrying the bump level alone (`patch`/`minor`/`major`). With several fragments pending, the release takes the highest bump (`major` over `minor` over `patch`, `changes.py` `highest_bump`). `python.yml` refuses a branch that changes `src/` and documents nothing. A direct `CHANGELOG.md` edit satisfies it **only until the first release** — before one there is nothing to bump from and the pending entry IS the changelog section; after one (detected by a `py-v*` tag existing) it documents the change but bumps nothing, so the release would find no fragment and republish a version the index already holds.

Neither is hand-versioned: both assemble the version and the changelog at release. The Python release additionally consumes its fragments, bumps `__version__` (the single source — `pyproject.toml` reads it via `dynamic = ["version"]`), and tags `py-v<version>` **after** a successful publish, so the tag is an output pointing at the published tree rather than an input naming a version nothing has computed yet.

`BACKEND_NPM_VERSION` is the backend a `pip install` user actually runs, so the npm release goes first; `release.yml` opens the pin bump as a PR, and `packages/selenium-devtools-py/scripts/check_backend_pin.py` refuses a PyPI publish whose pinned backend cannot serve the contract. That PR carries its own `changes/` fragment, because `python.yml` refuses a branch that changes `src/` and documents nothing — a pin-only PR would fail its own CI. It is a PR rather than a push because the pin is a claim about a *published* artifact and `check_backend_pin.py` is what adjudicates it; merging one queues a `patch` for the next PyPI release rather than bumping `__version__` there and then. Raised with `GITHUB_TOKEN` it arrives with **no checks at all** — GitHub suppresses workflow runs for events its own token raises — so either set `PIN_BUMP_TOKEN` or close/reopen the PR to get CI onto it.

