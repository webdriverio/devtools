---
minor
---

Frames now leave out an optional field instead of sending it as null:
`callSource` on commands and tests, `url` on session metadata, `status` and
`endTime` on a network request still in flight, and `state` on an unfinished
suite. A native session's viewport now carries `offsetLeft: 0`, `offsetTop: 0`
and `scale: 1`, as the JavaScript adapters send it. The payload types in
`selenium_devtools.types` are now generated from the dashboard's own schema;
`ElementScripts` is renamed to `ElementScriptsResponse`.
