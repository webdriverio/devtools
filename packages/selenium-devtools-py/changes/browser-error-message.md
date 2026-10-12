---
patch
---

A failed command's row now carries the browser's own error message, as the JavaScript adapters send it. It used to carry the exception's string form, so the dashboard's Errors tab showed `Message: ` before the text and the driver's stacktrace after it.
