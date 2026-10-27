---
'@wdio/selenium-devtools': patch
---

Keep Run all on the original command after a targeted rerun. A rerun's process was started with a name filter, and Run all used to be built from that process's own arguments, so it replayed the filter; it now inherits the command the dashboard's first run published. Run all also no longer comes out as `npm run npx` when the tests were started with `npx` or `pnpm exec`, and a spec path or filter containing a space now reaches the relaunched run as one argument.
