---
"@wdio/nightwatch-devtools": minor
"@wdio/devtools-app": patch
"@wdio/devtools-backend": patch
"@wdio/devtools-script": patch
"@wdio/selenium-devtools": patch
"@wdio/devtools-service": patch
---

Correctness pass over the dashboard and trace player, driven by a new component-test suite that ran the UI in a real browser for the first time.

- **DOM replay** now reproduces what the page actually did: a boolean attribute is replayed by presence rather than by value (`checked="false"` no longer replays as checked, and a `disabled="false"` the page set stays disabled), an attribute the page removed replays as removed instead of being recreated empty, a removed `value` empties a field that was never typed into while keeping text that was, and a text-only DOM change is captured and replayed at all.
- **Trace slices keep their step names**: a per-test slice dropped the metadata its step titles lived under, so every Gherkin step rendered as `stable-…:step:1` instead of its own text.
- **Network panel**: resource-type dots are coloured for a reconstructed trace, whose HAR reports no MIME type; a request that failed at the transport level reads `ERR` in both the list and the detail card rather than the dash that means "still in flight"; capture, wire and UI now share one request-type vocabulary.
- **Errors panel** no longer mangles assertion failures — each row is headed by what failed, a multi-line failure stays inside its own bullet, and one failure site is resolved per step.
- **Compare tab** appears only for the selected test, is windowed to that test's own uid, and keeps its toolbar on one line.
- **Run state survives a run's worker sockets**, so Preserve & Rerun no longer 409s on every spec but the last, and a dashboard opened mid-run replays the whole run instead of the current spec. Rerun filters also match the runner's own full-title form, so a rerun no longer reports the test as skipped.
- **Sidebar**: a running test can be stopped, a suite carries no verdict until one of its children settles, a Run All refusal is judged against `canRunAll` and says why, and the selection feeds the selected-test context.
- **Player**: listeners are torn down on disconnect, the viewport is shown, and the theme is honoured per instance.
- **Capture**: DOM capture recovers on a document that missed script injection, and Nightwatch cucumber runs now produce traces with native assertions captured.
- **Empty panels** explain why they are empty instead of drawing a loading skeleton forever.
