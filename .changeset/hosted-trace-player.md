---
'@wdio/devtools-app': minor
---

The trace player can now run as a static web page with no backend: built with `--mode hosted`, it opens a trace `.zip` the viewer drops on the page or picks, parsing it in the browser tab without uploading it or writing it to browser storage. This is the build trace.webdriver.io serves. The live dashboard is unchanged; the zip reader it does not use is loaded only when a file is opened.
