---
paths:
  - "packages/selenium-devtools-py/pyproject.toml"
  - "packages/selenium-devtools-py/changes/**"
  - "packages/selenium-devtools-py/src/**"
  - ".changeset/**"
  - ".github/workflows/release.yml"
  - ".github/workflows/python.yml"
  - ".github/workflows/python-release.yml"
  - "packages/selenium-devtools-py/scripts/changes.py"
---

# Releasing

Scope: npm changesets, Python-adapter release fragments, and the release workflows.

## Rules

- A published npm package change gets a changeset: `pnpm exec changeset`, committed as `.changeset/*.md`. Why: changesets finds packages through the pnpm workspace, and the Python adapter is not in it.
- A Python-adapter change gets a fragment in `packages/selenium-devtools-py/changes/` whose frontmatter carries only the bump level (`patch`, `minor` or `major`). Why: a changeset naming `selenium-devtools-py` fails `changeset version` and takes the npm release down with it.
- Never hand-edit the npm or Python version. Why: the release assembles the version and changelog from changesets and fragments.
- A direct `CHANGELOG.md` edit satisfies `python.yml` only before the first release (a `py-v*` tag exists after one, `packages/selenium-devtools-py/scripts/changes.py`). Why: after it, a direct edit documents without bumping, so the release finds no fragment and republishes an existing version.
- Publish npm before Python; the order is manual, since `python-release.yml` is `workflow_dispatch` with no `needs:` link to `release.yml`. Why: `BACKEND_NPM_VERSION` (`packages/selenium-devtools-py/src/selenium_devtools/constants.py`) names the backend a `pip install` user runs.
- Tag `py-v<version>` only after a successful publish. Why: the tag then names the published tree rather than a version nothing has computed yet.

## Accepted residuals

- `release.yml` opens the pin-bump PR with `GITHUB_TOKEN` unless `PIN_BUMP_TOKEN` is set. A PR raised with `GITHUB_TOKEN` gets no checks until it is closed and reopened.
