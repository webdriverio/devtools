# Pending changes

One file per user-visible change to this package, deleted when a release
consumes them. The same idea as `.changeset/` at the repo root, kept separate
because changesets reads the pnpm workspace and this package is not in it —
a changeset naming `selenium-devtools-py` is a hard error that fails the npm
release for every other package.

Add one with any filename ending `.md`:

```md
---
minor
---

Serve the page collector from the backend, so DOM replay works from a published
install.
```

The frontmatter is the bump level alone — `patch`, `minor` or `major`. The body
is what a user reading the changelog needs to know; write it for them, not for a
reviewer.

At release, `scripts/changes.py apply` takes the highest level of all pending
files, bumps `__version__`, writes the section into `CHANGELOG.md`, and deletes
the files it consumed. CI refuses a pull request that changes `src/` without
adding one.
