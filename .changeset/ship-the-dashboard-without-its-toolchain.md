---
'@wdio/devtools-app': patch
'@wdio/devtools-script': patch
---

Declare the build-time libraries as devDependencies, so installing the dashboard no longer installs the toolchain that built it. Both packages ship a bundle with everything already inlined — lit, preact, codemirror and the iconify set for the app; htm, parse5 and preact for the page script — yet listed them as runtime dependencies, and the script additionally listed a vite plugin, which pulled vite, rolldown and lightningcss onto every machine that installed the backend. The app also declared the WebdriverIO adapter it never imports.

Measured against the registry: installing `@wdio/devtools-backend` went from 338 packages and 264 MB to roughly 85 and 27 MB. That cost fell on every adapter, and hardest on the Python one, which fetches the backend at runtime.
