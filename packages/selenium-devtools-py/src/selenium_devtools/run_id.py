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

    That is the known limit for multi-process pytest (xdist): the plugin loads
    per worker with no launcher-side hook to stamp first, so siblings disagree.
    Deriving a fallback from the parent pid would group them, but would also make
    two sequential single-process runs share an id and inherit each other's
    state — which is why the per-process fallback stands. Tracked as issue #297.
    """
    existing = os.environ.get(ENV_RUN_ID)
    if existing:
        return existing
    run_id = str(uuid.uuid4())
    os.environ[ENV_RUN_ID] = run_id
    _generated.add(run_id)
    return run_id


# Ids this process minted, as opposed to inherited. Only these may be cleared.
_generated: set = set()


def reset_run_id() -> None:
    """Forget an id this process generated, so the next run is a NEW run.

    A process can host several logical runs — ``enable()``, ``disable()``,
    ``enable()`` — and an id that outlives the first makes the backend read the
    second as a continuation, so it keeps the first run's commands, logs, network
    data and baselines. Sending no id at all used to make every connect wipe,
    which is why this only became reachable once the id started being sent.

    Only an id we MINTED is cleared. One a launcher exported before forking
    belongs to the parent and is how siblings agree they are one run; discarding
    it here would split a parallel run into one run per worker.
    """
    current = os.environ.get(ENV_RUN_ID)
    if current and current in _generated:
        _generated.discard(current)
        os.environ.pop(ENV_RUN_ID, None)
