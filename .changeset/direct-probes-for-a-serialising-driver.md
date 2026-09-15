---
"@wdio/devtools-service": patch
"@wdio/nightwatch-devtools": patch
---

Stop the WDIO service deadlocking a mobile-web Appium session. `beforeCommand` issues its probes — the collector drain, the per-action snapshot's two scripts plus `url`/`title`, and the `__wdioSnapMark` tag — from inside the hook wrapping the command it is observing. Desktop chromedriver tolerates that re-entrancy; Appium serialises per session, so each probe enqueued behind the command it was meant to observe and neither resolved. Measured on an emulator: a two-command mobile-web spec passes in 1.6 s without the service and took 6 m 13 s of timeouts with it, every command at the WDIO timeout, with Chrome still on its new-tab page.

The probes now go straight to the driver's HTTP endpoint for a session whose driver serialises, which is the only escape that does not change the ordering guarantee the pre-action snapshot depends on — the alternative, not awaiting in the hook, trades "state BEFORE this action executes" for every adapter and platform.

The transport moved to `core` rather than being copied: Nightwatch has needed exactly this since its own command queue posed the same problem, and its `helpers/webdriverHttp.ts` now delegates to it, keeping only the part that is genuinely framework-specific — walking Nightwatch's internal config for the driver's host and port. Two things the Nightwatch version could not do are in the core one because the service needs them: https, and basic auth from the connection's `user`/`key`, since a cloud grid answers 401 without it and a probe that silently 401s reads as a capture gap rather than an error.

Gated on `isAppiumSession`, not on being native. A native session skips these probes entirely, so the one that needed this is the mobile **web** session — it has a document and is driven through Appium. Desktop keeps `browser.*`, which carries WDIO's own retries and interceptors, because the re-entrancy is only fatal where the driver serialises. A session whose address is not knowable from the connection options also keeps the normal path: guessing localhost would aim a probe at whatever else is listening there.
