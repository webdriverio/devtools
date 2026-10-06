---
'@wdio/devtools-script': patch
---

Keep waiting for a `<body>` however late it arrives. The collector checked for a body on one animation frame only, then gave up after 10 seconds. It runs as a document-start preload, so a page whose `<head>` blocked on a slow asset (measured: 30 seconds behind a 503) got no DOM anchor and no form-field capture. Every action on that page then replayed an earlier document instead, and typed values never showed. The collector now checks on every frame, and on `DOMContentLoaded` for a background tab that paints none, with no timeout.
