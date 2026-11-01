# Changesets

This project uses [changesets](https://github.com/changesets/changesets) for per-package versioning and publishing.

## Creating a changeset

When you make a change that needs a version bump, create a changeset file.

**Interactive** — pick packages, bump type, and write a summary:

```bash
pnpm changeset
```

**Automated** — generate the changeset from conventional commits that touched a package since the last tag:

```bash
pnpm changeset:gen @wdio/elements          # auto-infers patch/minor
pnpm changeset:gen @wdio/elements minor    # override bump
```

Both produce a `.changeset/<slug>.md` file. Commit it with your PR.

## How releases work

1. PRs land on `main` with their changeset files — they **accumulate**.
2. The **Release** workflow is triggered manually via `workflow_dispatch` on `main`.
3. `changeset version` consumes all pending `.md` files: bumps `package.json` versions, writes per-package `CHANGELOG.md`, deletes the consumed files, and auto-commits.
4. `changeset publish` publishes every bumped package to npm and creates git tags.
5. The commit and tags are pushed back to `main`.

Only packages with pending changesets get bumped and published. Multiple changesets for the same package are merged — the highest bump wins (two `patch` + one `minor` = `minor`).

## Future

The `workflow_dispatch` trigger can be replaced with `push: [main]` to enable automatic CI/CD on every merge that carries changeset files.

## Config

| File | Role |
|---|---|
| `.changeset/config.json` | `commit: true` (auto-commit after version), `access: public` |
| `.changeset/changeset-gen.sh` | Helper to generate a changeset from conventional commits |
| `.github/workflows/release.yml` | Manual trigger → `changeset version` → `changeset publish` → push |
