---
'@wdio/devtools-backend': minor
---

A trace the backend writes for the Python adapter now carries the element list and accessibility tree of each native app action. The adapter sends the page source it read for the action, and the backend parses it with the same code the JavaScript adapters run, so the A11y tab and the element locators read the same in all four adapters. The backend now depends on `@xmldom/xmldom` and `xpath` to do so.
