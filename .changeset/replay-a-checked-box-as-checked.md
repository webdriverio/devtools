---
'@wdio/devtools-app': patch
---

Replay a boolean attribute the page itself set. The DOM anchor captures markup, so a page's own `<input type="checkbox" checked>` arrives as `checked=""` — and Preact assigns these as properties, where `''` is falsy, so the box replayed unchecked while the screencast showed it ticked. Every boolean attribute was affected: a disabled control replayed as usable, and a `checked="false"` from a cleared box replayed as ticked, since a non-empty string is truthy.

The vnode path now resolves them through the same two helpers the mutation path already used, so one policy decides both routes into the replayed DOM.
