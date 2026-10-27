---
'@wdio/nightwatch-devtools': patch
'@wdio/devtools-backend': patch
'@wdio/devtools-app': patch
---

Enable Run all for Nightwatch, which the dashboard disabled although the backend could already run the whole config. Run all now replays the selection the run was launched with (spec paths, `--tag`, `--group`, `--env` and the like) rather than every spec in the config, and a rerun in between does not narrow it.
