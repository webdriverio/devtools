---
'@wdio/selenium-devtools': patch
---

A plain `node script.js` run with no test runner is now captured without calling `DevTools.startTest`: its commands land under the "Selenium Session" row the README describes, where before every command was dropped. Such a script also exits once its work is done, where before the open dashboard connection kept the process alive indefinitely, which also left a rerun of a plain script running after it finished.
