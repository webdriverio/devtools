---
'@wdio/selenium-devtools': patch
---

`DevTools.configure()` now applies `port`, `hostname`, `captureScreenshots`, `filmstrip` and `emitArtifactsManifest`. They were documented as configure options but silently ignored, so the defaults always applied. `port`/`hostname` passed after the backend start has begun are ignored with a warning, and an invalid port or a `null` value is refused rather than applied. A rerun keeps its parent's backend whatever they say.
