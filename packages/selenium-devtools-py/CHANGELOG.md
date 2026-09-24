# selenium-devtools-py

Assembled at release from the fragments in `changes/` — see that directory's
README. Changesets generates the npm packages' changelogs from the pnpm
workspace, which this package is not a member of, so it has its own mechanism
of the same shape.

## 0.1.0

First release.

Python Selenium adapter for the WebdriverIO DevTools dashboard, feeding the same
backend and UI as the JavaScript adapters over the language-neutral
`{scope, data}` WebSocket contract.

- **Live mode** — command capture and the test tree, browser console and network
  over BiDi, assertion rows, per-command screenshots and selectors, DOM replay,
  and a pushed CDP screencast.
- **Trace mode** — the same portable `trace.zip` the JavaScript adapters write,
  with action snapshots, sources and a transcript. Built by the backend on the
  adapter's behalf, since this package ships no Node.
- **Run controls** — Run, Rerun, Run-all and Preserve & Rerun, with reruns
  selected by pytest nodeid and spawned in pytest's own rootdir.
- **pytest plugin** — auto-discovered, opt-in per run (`--devtools`,
  `--devtools-trace`), per project (`[tool.pytest.ini_options]`) or per shell
  (`DEVTOOLS_ENABLE`). Installing it never changes how an existing suite behaves.
- Ships `py.typed`, so the annotations already on the public API reach a
  consumer's type checker instead of resolving to `Any`.
- Requires Python 3.10+, `selenium>=4.44`, and Node.js 18+ on PATH for the
  backend.

Known gaps against the JavaScript adapters are listed under Roadmap in the
README.
