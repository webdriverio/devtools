---
'@wdio/devtools-backend': patch
'@wdio/devtools-service': patch
'@wdio/selenium-devtools': patch
'@wdio/nightwatch-devtools': patch
---

A trace's screenshots are named by their actual image format. A PNG capture used to be stored as `resources/<page>-<timestamp>.jpeg`, so a viewer that takes the content type from the file name served it as `image/jpeg`; it is now `.png`, and so is a PNG frame of the dense filmstrip. Traces written before this change still open.
