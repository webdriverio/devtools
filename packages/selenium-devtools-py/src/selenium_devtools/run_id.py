"""Identity for one test run, shared by every process reporting into it.

The backend compares this across worker connects to tell "the next spec of this
run" (keep the accumulated state) from "a new run" (wipe it). Without it every
connect is a new run: the message buffer and the baseline store's active run are
cleared, so earlier tests' data is gone and Preserve & Rerun has nothing to diff.

Mirrors ``core/run-id.ts`` ``resolveRunId``, including the env var it publishes,
so a Python worker and a JS one in the same run agree on identity rather than
each inventing their own.
"""

from __future__ import annotations

import os
import uuid

from ._contract import ENV_RUN_ID


def resolve_run_id() -> str:
    """This run's id, generating and publishing one on first call.

    Runners fork workers with the launcher's environment, so whoever gets here
    first decides for everyone that follows. A launcher that calls this before
    forking gives every worker the same id; a worker that gets here first can
    only speak for itself, and each sibling then reads as its own run.

    An inherited id is adopted ONLY for this process's first run. Sibling
    agreement is a question about how a run STARTS, so it has nothing to say
    about a run that starts after another one ended here: that is a new run
    whatever the environment still holds, and reusing the id would have the
    backend keep the finished run's commands, logs, network data and baselines.

    That is the known limit for multi-process pytest (xdist): the plugin loads
    per worker with no launcher-side hook to stamp first, so siblings disagree.
    Deriving a fallback from the parent pid would group them, but would also make
    two sequential single-process runs share an id and inherit each other's
    state — which is why the per-process fallback stands. Tracked as issue #297.
    """
    global _run_ended
    existing = os.environ.get(ENV_RUN_ID)
    if existing and not _run_ended:
        return existing
    run_id = str(uuid.uuid4())
    os.environ[ENV_RUN_ID] = run_id
    _generated.add(run_id)
    _run_ended = False
    return run_id


# Ids this process minted, as opposed to inherited. Only these are cleared from
# the environment, so a child forked later cannot join a run that already ended.
_generated: set = set()

# Whether a run has already finished in this process. What makes the NEXT
# `enable()` a new run rather than a continuation of the last one.
_run_ended = False


def reset_run_id() -> None:
    """End this run, so the next one in this process is a NEW run.

    A process can host several logical runs — ``enable()``, ``disable()``,
    ``enable()`` — and an id that outlives the first makes the backend read the
    second as a continuation, keeping the first run's commands, logs, network
    data and baselines. Sending no id at all used to make every connect wipe,
    which is why this only became reachable once the id started being sent.

    The environment is cleared only for an id we MINTED: one exported before this
    process started belongs to whoever set it, and a child we fork later would
    otherwise inherit a run that has finished. Either way the flag is what
    guarantees the next run is new, so an inherited id cannot be reused after the
    run it belonged to has ended.
    """
    global _run_ended
    _run_ended = True
    current = os.environ.get(ENV_RUN_ID)
    if current and current in _generated:
        _generated.discard(current)
        os.environ.pop(ENV_RUN_ID, None)
