---
'@wdio/nightwatch-devtools': patch
---

Stamp a stable numeric `id` on Nightwatch command rows in `captureCommand` and preserve it across `replaceCommand`, and skip late screenshot replacements for rows already superseded in `commandsLog`. This prevents a late screenshot update on a command like `getText` from overwriting a `node:assert` row stamped in the same millisecond.
