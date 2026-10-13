---
'@wdio/selenium-devtools': patch
---

`DevTools.configure()` now applies `port`, `hostname`, `captureScreenshots`, `filmstrip` and `emitArtifactsManifest`. They were documented as configure options but silently ignored, so the defaults always applied. `port`/`hostname` passed after the backend start has begun are ignored with a warning, and an invalid port, a `null` value or a value of the wrong type (for example the string `'false'` for a boolean option) is refused with a warning rather than applied. A rerun keeps its parent's backend whatever they say.
