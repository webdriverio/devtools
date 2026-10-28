---
'@wdio/devtools-backend': patch
'@wdio/selenium-devtools': patch
'@wdio/nightwatch-devtools': patch
---

The backend serves the page scripts that probe, inject and drain the DOM collector and read navigation timings at `/api/page-scripts`, so the Python adapter runs the same scripts as the JS adapters instead of its own copies. The Selenium and Nightwatch adapters now inject the collector with that same shared script.
