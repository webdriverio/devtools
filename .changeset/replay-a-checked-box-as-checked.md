---
'@wdio/devtools-app': patch
---

Replay a boolean attribute the page itself set. The DOM anchor captures markup, so a page's own `<input type="checkbox" checked>` arrives as `checked=""` — and Preact assigns these as properties, where `''` is falsy, so the box replayed unchecked while the screencast showed it ticked. Every boolean attribute was affected the same way: a control the page disabled replayed as usable, a selected option as unselected.

Captured markup now replays on presence alone, which is what HTML means: `checked="false"` in a page's own markup is a ticked box. That is deliberately NOT the mutation path's rule, where "false" is the collector reporting a cleared field — a signal that only ever arrives as a mutation record, never as markup.
