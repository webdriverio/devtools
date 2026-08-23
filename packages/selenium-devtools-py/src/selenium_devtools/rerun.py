"""The commands the dashboard's Run and Rerun controls spawn.

A rerun is not a message to this process. The dashboard POSTs to
``/api/tests/run`` and the backend execs a command string the adapter published
in its metadata, in a FRESH process — so the whole feature is decided here,
before any test runs, and shipped once:

``launchCommand``
    Re-runs everything. Services the header's Run-all, and is what the backend
    falls back to for anything it cannot target.
``rerunCommand``
    The same command narrowed to one entry, ending in the slot the backend
    fills with that entry's uid.

A pytest entry's uid is its nodeid, and a nodeid addresses a file, a class or a
single test in one syntax (``file.py``, ``file.py::Class``,
``file.py::Class::test``). That is why one slot covers every row the tree can
offer, where the name-pattern runners need a filter flag per level and a
special case for the ones whose flag matches only leaves.

A plain script cannot address a part of itself, but it does not need to: its
tree is one synthetic suite holding one synthetic test, and both denote the
whole run, so the launch command doubles as the rerun template and every
control is serviceable. Capabilities are DERIVED from which commands were built
rather than declared: a control the adapter advertises but cannot service is
worse than one it never offered, because the backend's fallback for a command
it wasn't given is the wdio binary.

Where the rerun REPORTS is `backend.reuse_target()`'s job, not this module's —
the backend points the child it spawns back at itself.
"""

from __future__ import annotations

import logging
import os
import shlex
import sys
from typing import Dict, List, Optional, Sequence

from ._contract import ENV_RUNNER_CWD, RERUN_SLOT_TEST_ID
from .constants import LOGGER_NAME, RUN_CAPABILITIES_NONE

_log = logging.getLogger(f"{LOGGER_NAME}.rerun")

# Options that narrow which tests run. A targeted rerun names its entry
# outright, so any of these left in place can only narrow that further — `-k
# login` alongside an explicit nodeid for `test_logout` selects nothing at all,
# and pytest reports that as a clean exit, so the rerun looks like it worked.
#
# The xdist ones go for a second reason: a one-entry rerun has nothing to
# parallelise, and each worker it spawned would connect to the dashboard under
# its own run id (see run_id.py), so one rerun would report as several runs.
_VALUE_FILTERS = ("-k", "-m", "--deselect", "-n", "--numprocesses", "--dist")
_FLAG_FILTERS = (
    "--lf",
    "--last-failed",
    "--ff",
    "--failed-first",
    "--nf",
    "--new-first",
    "--sw",
    "--stepwise",
    "--stepwise-skip",
)
_SHORT_VALUE_FILTERS = tuple(opt for opt in _VALUE_FILTERS if len(opt) == 2)

_options: Dict[str, object] = {"runCapabilities": dict(RUN_CAPABILITIES_NONE)}

# The value we last wrote to ENV_RUNNER_CWD, or None if we never wrote one.
# The VALUE and not a "we wrote it once" flag, because two different things
# have to be told apart at the second run: our own leftover, which must be
# replaced, and a value the caller put there since, which must be respected.
# A flag says only that we wrote at some point and cannot distinguish them.
# Deliberately not cleared by `reset()` — what this process wrote survives a
# disable/enable, and forgetting it would read our leftover as an instruction.
_stamped_runner_cwd: Optional[str] = None


def run_options() -> Dict[str, object]:
    """The `options` bag the metadata frame carries."""
    return dict(_options)


def reset() -> None:
    """Forget what was configured — a re-`enable()` reconfigures from scratch."""
    global _options
    _options = {"runCapabilities": dict(RUN_CAPABILITIES_NONE)}


def _reset_for_tests() -> None:
    """Reset module state between unit tests (never used in production).

    Includes the ENV_RUNNER_CWD stamp, which a real process keeps for its
    lifetime and `reset()` therefore leaves alone — a test needs the
    fresh-process state instead.
    """
    global _stamped_runner_cwd
    reset()
    _stamped_runner_cwd = None


def configure_script(argv: Optional[Sequence[str]] = None) -> None:
    """Publish the relaunch command for a plain script.

    A no-op once anything is published: a framework plugin configures before
    the adapter is enabled and knows how to address one test, which this
    cannot. So this is the floor, never an override.
    """
    if _options.get("launchCommand") or _options.get("rerunCommand"):
        return
    args = list(argv if argv is not None else sys.argv)
    script = args[0] if args else ""
    # No script to relaunch: `python -c ...` reports the flag itself here and an
    # interactive session reports nothing. Publishing either would advertise a
    # Run-all that cannot work, which is worse than leaving it refused.
    if not script or not os.path.isfile(script):
        return
    launch = _quote([sys.executable, os.path.abspath(script), *args[1:]])
    # The same command services a row-scoped rerun, because a script's tree is
    # one synthetic suite holding one synthetic test — both denote the whole
    # run, so relaunching it IS running that row. Refusing those two controls
    # would leave a disabled button beside the only row the tree has. The
    # template carries no slot, so the backend substitutes nothing into it.
    _publish(launch=launch, rerun=launch, base_dir=os.getcwd())


def configure_pytest(
    *, args: Sequence[str], positionals: Sequence[str], rootdir: Optional[str]
) -> None:
    """Publish both commands for a pytest run.

    `args` is pytest's own argument list (no program name), `positionals` the
    file/dir/nodeid arguments pytest resolved out of it, and `rootdir` the
    directory its nodeids are relative to.
    """
    launch = _quote(
        [sys.executable, "-m", "pytest", *_absolute_positionals(args, positionals)]
    )
    targeted = _drop_positionals(_strip_filters(args), positionals)
    rerun = (
        f"{_quote([sys.executable, '-m', 'pytest', *targeted])} {RERUN_SLOT_TEST_ID}"
    )
    _publish(launch=launch, rerun=rerun, base_dir=rootdir or os.getcwd())


def _publish(*, launch: Optional[str], rerun: Optional[str], base_dir: str) -> None:
    global _options
    options: Dict[str, object] = {
        "runCapabilities": {
            "canRunSuites": bool(rerun),
            "canRunTests": bool(rerun),
            "canRunAll": bool(launch),
        }
    }
    if launch:
        options["launchCommand"] = launch
    if rerun:
        options["rerunCommand"] = rerun
    _options = options
    _stamp_runner_cwd(base_dir)


def _stamp_runner_cwd(base_dir: str) -> None:
    """Name the directory the backend spawns a rerun in.

    It has to be the ROOTDIR for pytest, not the invocation directory: a nodeid
    is reported relative to rootdir but a positional path is resolved relative
    to the process's cwd, so the two only agree when the run was launched from
    rootdir. Spawning elsewhere makes every nodeid a path that does not exist.

    The backend reads this from its own environment, so it only lands if we own
    that process — an already-running dashboard keeps the cwd it was started in.

    Still holding what we wrote, it is REPLACED: a second `enable()` in one
    process is a second run, and keeping the first one's directory would spawn
    its reruns in the wrong project, where every nodeid names a path that does
    not exist. Holding anything else, it is left alone — an explicit
    `DEVTOOLS_RUNNER_CWD` is an instruction, whenever it was exported.
    """
    global _stamped_runner_cwd
    current = os.environ.get(ENV_RUNNER_CWD)
    if current is not None and current != _stamped_runner_cwd:
        return
    _stamped_runner_cwd = os.path.abspath(base_dir)
    os.environ[ENV_RUNNER_CWD] = _stamped_runner_cwd


def _strip_filters(args: Sequence[str]) -> List[str]:
    """Drop the options that narrow a run to a subset of its tests.

    Attached and `=` forms are matched by prefix (`-kexpr`, `--deselect=x`).
    Clustered short options (`-xk expr`) are not recognised — argparse allows
    them but nothing writes them, and a partial match would strip a flag the
    run needs.
    """
    kept: List[str] = []
    skip_value = False
    for arg in args:
        if skip_value:
            skip_value = False
            continue
        if arg in _FLAG_FILTERS:
            continue
        if arg in _VALUE_FILTERS:
            skip_value = True
            continue
        if any(arg.startswith(f"{opt}=") for opt in _VALUE_FILTERS):
            continue
        if any(
            arg.startswith(opt) and len(arg) > len(opt) for opt in _SHORT_VALUE_FILTERS
        ):
            continue
        kept.append(arg)
    return kept


def _drop_positionals(
    args: Sequence[str], positionals: Sequence[str]
) -> List[str]:
    """Drop the file/dir/nodeid arguments the run was launched with.

    pytest UNIONS its positional selectors, so one left in place is selected in
    addition to the rerun's own target — the rerun would run the whole original
    selection again, and a second rerun would stack another selector on top.

    Which arguments are positional is asked of pytest rather than inferred:
    guessing needs a table of every option that takes a value, and dropping a
    value while keeping its option makes that option swallow the id we append.
    """
    drop = set(positionals)
    return [arg for arg in args if arg not in drop]


def _absolute_positionals(
    args: Sequence[str], positionals: Sequence[str]
) -> List[str]:
    """Absolutise the positional paths, leaving every other argument alone.

    The launch command is spawned from rootdir (see `_stamp_runner_cwd`) while
    its paths were written relative to wherever the run was launched. Only the
    positionals are rewritten — an option's relative path argument is left as
    written, and resolves only if those two directories agree.
    """
    targets = set(positionals)
    return [_absolute_target(arg) if arg in targets else arg for arg in args]


def _absolute_target(arg: str) -> str:
    """Absolutise the path half of a positional, keeping any `::` selector."""
    path, sep, selector = arg.partition("::")
    return f"{os.path.abspath(path)}{sep}{selector}"


def _quote(args: Sequence[str]) -> str:
    return " ".join(shlex.quote(arg) for arg in args)


def log_published() -> None:
    """Say what the dashboard's run controls will do, once, at bringup.

    Worth a line because the alternative way to find out is to click a button
    and watch nothing happen.
    """
    caps = _options.get("runCapabilities", {})
    targeted = isinstance(caps, dict) and caps.get("canRunTests")
    if targeted:
        _log.info("dashboard can rerun a single test, a suite, or the whole run")
    elif isinstance(caps, dict) and caps.get("canRunAll"):
        _log.info(
            "dashboard can rerun the whole run; single tests are not "
            "addressable outside a test framework"
        )
    else:
        _log.info("dashboard run controls are unavailable for this invocation")
