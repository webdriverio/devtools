---
'@wdio/devtools-backend': patch
---

Pass the run-everything command to a rerun child. A child is spawned with one test named on its command line, so an adapter that derives its Run-all command from its own invocation republishes "run that one test" as the command for running everything — after which Run-all reruns only whatever was last reran. The child cannot reconstruct what it was narrowed from, so the spawner now hands the original down alongside the rest of the reuse handshake.
