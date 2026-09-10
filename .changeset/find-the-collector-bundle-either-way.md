---
"@wdio/devtools-core": patch
"@wdio/devtools-service": patch
"@wdio/selenium-devtools": patch
"@wdio/nightwatch-devtools": patch
---

Find the collector bundle whether the package resolved to its build or its source. `loadCollectorSource` resolved `@wdio/devtools-script` and then read `script.js` from **that entry's directory**, which only holds when the entry is the built one. The repo tsconfig maps the package to `packages/script/src/index.ts`, and every resolver honouring those paths lands there instead — `tsx` and `ts-node` among them, which is how `wdio run <conf>.ts` loads a config. The read then ENOENTs on `packages/script/src/script.js`.

Nothing failed loudly, which is why this survived: every caller treats an injection failure as a warning, so the run continued and lost its DOM capture. Surfaced as `Collector re-injection failed: ENOENT … packages/script/src/script.js` on a mobile-web Appium run, and reproduced in three lines against a plain `tsx` entry point, so it was never mobile-specific — any TS-config-driven run was affected.

The bundle is now looked for beside the entry *and* at `../dist/script.js`, and a genuine miss reports every path it tried instead of only the last.
