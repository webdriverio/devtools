---
'@wdio/devtools-app': patch
'@wdio/devtools-backend': patch
---

Open large traces faster and in less memory: the player now reads a trace zip's directory and streams up front, and each frame image, stored response body, stylesheet and font only when it shows it, instead of unpacking and base64-encoding every entry before the first render. The filmstrip draws as many frames as fit its width. `show-trace` serves a single zip the way it serves several, for the player to read with the same reader; `start({ trace })` still serves a reconstructed payload whose frames carry their images inline as base64 (`LegacyTracePlayerData`, the shape older backends serve), and the player plays one served that way. A player trace is never written to browser storage.
