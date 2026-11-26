---
patch
---

A value typed with `send_keys` is now redacted when the adapter could not check whether its field is a password field: the field-type read failed or timed out, or the session's reads stopped after an earlier timeout. Previously the value was left as typed and the password could reach the dashboard and the trace. One warning that names no value is logged.
