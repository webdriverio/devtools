"""pytest plugin — feeds the suite/test tree to the dashboard.

The analogue of the JS adapter's mocha/jest hooks. Inert unless the run opts in
via ``DEVTOOLS_ENABLE=1`` or ``DEVTOOLS_PORT=...`` so installing the package never
hijacks an unrelated pytest run. On opt-in it enables capture at session start,
stamps per-test timing, and re-sends the ``suites`` frame as each test reports.
"""

from __future__ import annotations

import logging
import os
import sys
from typing import Dict, Optional

import selenium_devtools as devtools
from . import assertions, frames, rerun
from .constants import ENV_OPT_IN, ENV_PORT, LOGGER_NAME
from .utils import now_ms

_log = logging.getLogger(f"{LOGGER_NAME}.pytest")

# The operands of the comparison pytest reported most recently, waiting for the
# hook that reports its outcome. See assertions.ComparisonBuffer.
_comparisons = assertions.ComparisonBuffer()


def _opted_in() -> bool:
    return bool(os.environ.get(ENV_OPT_IN) or os.environ.get(ENV_PORT))


def _rolled_up_state(tests: list, suites: list) -> str:
    """A group is failed if anything under it failed, else running while any
    child still has work left, else its children's outcome. Mirrors how the JS
    reporters roll a describe block up. A group is only `pending` while NONE of
    its children has started — one finished test makes the group in-progress."""
    states = [t["state"] for t in tests] + [s["state"] for s in suites]
    if "failed" in states:
        return "failed"
    if "running" in states:
        return "running"
    if "pending" in states:
        return "pending" if all(s == "pending" for s in states) else "running"
    return "passed" if "passed" in states else "skipped"


class _SuiteRegistry:
    """Builds the SuiteStats[] tree the dashboard expects.

    pytest has no describe/it blocks: a module groups tests, and a CLASS groups
    them one level deeper. `report.location` flattens that middle level into the
    name (`TestLogin.test_valid`), so the class is split back out of the nodeid
    (`file::Class::test`) into a nested suite — otherwise a class-based suite
    renders as flat rows under the file, while the equivalent mocha `describe`
    nests.
    """

    def __init__(self) -> None:
        self._suites: Dict[str, dict] = {}
        self._classes: Dict[str, dict] = {}
        self._tests: Dict[str, dict] = {}
        self._starts: Dict[str, int] = {}

    def mark_start(self, nodeid: str) -> None:
        self._starts.setdefault(nodeid, now_ms())

    def record(
        self,
        nodeid: str,
        file: str,
        name: str,
        line: int,
        state: str,
        abs_file: Optional[str] = None,
    ) -> None:
        # `file` is pytest's rootdir-relative path: it prefixes every nodeid, so
        # it stays the grouping key and the readable title. `abs_file` is the
        # same file resolved absolutely, and is what goes on the wire — the
        # `sources` map is keyed by each command's absolute callSource, and the
        # app pairs the two by exact path, so a relative one leaves the Source
        # tab reporting the file as never captured the moment a test is picked.
        path = abs_file or file
        # Sibling position is the SOURCE LINE, never this run's collection
        # index. pytest runs in collection order and interleaves module-level
        # tests with classes, which the tree's default (a suite's own tests,
        # then its nested suites) cannot express — but an index describes only
        # the collection it came from. A rerun collects one test, so its index
        # is 0 and the row jumps to the top of its file, taking the class suite
        # it used to sit below with it. A line is a property of the test, so it
        # survives a partial collection; within a module pytest collects in
        # definition order, so the two agree wherever both are meaningful.
        position = line
        # `_starts` is only populated once the test actually starts, so a test
        # recorded at COLLECTION does not freeze a start time it never had.
        start = self._starts.get(nodeid, now_ms())
        done = state not in ("pending", "running")
        end = now_ms() if done else start
        file_suite = self._suites.setdefault(
            file,
            frames.suite_stats(uid=file, title=file, file=path,
                               start_ms=start, tests=[]),
        )
        # `file::Class::test` has a class; `file::test` does not. Parametrized
        # ids (`test[a-b]`) keep their brackets in the leaf, never in the class.
        parts = nodeid.split("::")
        class_name = parts[1] if len(parts) > 2 else None
        # The name pytest reports is `Class.test` for a method; the leaf row
        # shows just the test, since the class is now its own node.
        title = name.split(".", 1)[1] if class_name and "." in name else name

        parent_uid = f"{file}::{class_name}" if class_name else file
        parent_title = class_name or file
        self._tests[nodeid] = frames.test_stats(
            uid=nodeid,
            title=title,
            full_title=f"{file} › {name}",
            parent=parent_title,
            state=state,
            file=path,
            start_ms=start,
            end_ms=end,
            call_source=f"{path}:{line + 1}",
            order=position,
        )
        if class_name:
            class_suite = self._classes.setdefault(
                parent_uid,
                frames.suite_stats(uid=parent_uid, title=class_name, file=path,
                                   start_ms=start, tests=[], order=position),
            )
            class_suite["parent"] = file
            class_suite["fullTitle"] = f"{file} › {class_name}"
            class_suite["tests"] = self._tests_under(parent_uid, depth=3)
            positions = [
                t["order"] for t in class_suite["tests"] if "order" in t
            ]
            if positions:
                class_suite["order"] = min(positions)
            class_suite["end"] = self._tests[nodeid]["end"] if done else None
            class_suite["state"] = _rolled_up_state(class_suite["tests"], [])

        file_suite["tests"] = self._tests_under(file, depth=2)
        file_suite["suites"] = [
            s for uid, s in self._classes.items()
            if uid.split("::", 1)[0] == file
        ]
        file_suite["end"] = self._tests[nodeid]["end"] if done else None
        file_suite["state"] = _rolled_up_state(
            file_suite["tests"], file_suite["suites"]
        )

    def _tests_under(self, prefix: str, *, depth: int) -> list:
        """Tests whose nodeid sits DIRECTLY under `prefix` — `depth` is how many
        `::` segments such a nodeid has, so a class's tests never also count as
        the file's."""
        return [
            t for nid, t in self._tests.items()
            if nid.startswith(f"{prefix}::") and len(nid.split("::")) == depth
        ]

    def snapshot(self) -> list:
        return list(self._suites.values())


_registry = _SuiteRegistry()

#: pytest's rootdir, captured at configure. `report.location[0]` is relative to
#: it, and the dashboard pairs a test with its captured source by exact path.
_rootdir: Optional[str] = None


def _absolute(file: str) -> str:
    """`file` resolved against pytest's rootdir. Already-absolute paths and an
    unknown rootdir both pass through, so this can never make a path worse."""
    if os.path.isabs(file) or not _rootdir:
        return file
    return os.path.normpath(os.path.join(_rootdir, file))

# Note: test-file source capture for the Source tab lives in instrumentation.py
# (keyed by each command's callSource path), so it works for plain scripts too —
# not just pytest. The plugin only owns the suite/test tree.


def _enable_assertion_pass_hook(config) -> None:  # noqa: ANN001
    """Switch on pytest's passing-assertion hook for this run.

    Without it pytest reports only FAILING assertions, so the dashboard would
    show a row for an assertion that broke and nothing for one that held. It is
    off by default because it costs a little speed, and is enabled here rather
    than asked of the user — an option they have to find in their own config to
    make the tool work is an option most people never find.

    Set on `inicfg` and the cache cleared behind it, because `getini` memoizes on
    first read and the rewriter reads it per module during collection, which is
    after this hook.

    A BOOL, not the string an ini file would carry: pytest 9 type-checks the
    value and rejects `"true"` for a bool option. And read back inside the try,
    because that check runs where the value is CONSUMED — during collection, per
    module — so a value pytest will not accept surfaces as a collection error in
    the user's run rather than as a failure here. Reading it now moves the error
    to where it can be undone.
    """
    absent = object()
    previous = config.inicfg.get("enable_assertion_pass_hook", absent)
    try:
        config.inicfg["enable_assertion_pass_hook"] = True
        _forget_ini_cache(config)
        config.getini("enable_assertion_pass_hook")  # validates; may raise
    except Exception as exc:  # noqa: BLE001 — never break the user's run
        if previous is absent:
            config.inicfg.pop("enable_assertion_pass_hook", None)
        else:
            config.inicfg["enable_assertion_pass_hook"] = previous
        _forget_ini_cache(config)
        _log.warning(
            "passing assertions will not be captured — pytest rejected the "
            "assertion-pass hook option: %s",
            exc,
        )


def _forget_ini_cache(config) -> None:  # noqa: ANN001
    """Drop the memoized value so the next `getini` re-reads `inicfg`."""
    cache = getattr(config, "_inicache", None)
    if isinstance(cache, dict):
        cache.pop("enable_assertion_pass_hook", None)


def _configure_rerun(config, rootdir: Optional[str]) -> None:  # noqa: ANN001
    """Hand pytest's own view of its invocation to the rerun builder.

    `invocation_params.args` is the raw argument list and `config.args` the
    file/dir/nodeid arguments pytest resolved out of it — asking pytest which
    were positional is what makes stripping them safe, since inferring it needs
    a table of every option that takes a value. Both are read here, before
    `enable()`, because the directory a rerun spawns in reaches the backend
    through the environment its process inherits.
    """
    params = getattr(config, "invocation_params", None)
    args = list(getattr(params, "args", ()) or ())
    rerun.configure_pytest(
        args=args,
        positionals=list(getattr(config, "args", ()) or ()),
        rootdir=rootdir,
    )


def pytest_configure(config) -> None:  # noqa: ANN001
    if _opted_in():
        _enable_assertion_pass_hook(config)
        global _rootdir
        # `rootpath` on pytest 7+, `rootdir` before it.
        root = getattr(config, "rootpath", None) or getattr(config, "rootdir", None)
        _rootdir = str(root) if root else None
        _configure_rerun(config, _rootdir)
        capturer = devtools.enable()
        # pytest owns the suite tree — suppress the adapter's default script suite.
        from . import instrumentation

        instrumentation.set_external_suites(True)
        url = devtools.dashboard_url()
        if capturer is not None and url:
            print(f"\n[devtools] dashboard live at {url}\n")


def _publish(capturer) -> None:  # noqa: ANN001
    capturer.send_suites(_registry.snapshot())


def pytest_collection_finish(session) -> None:  # noqa: ANN001
    """Publish the whole tree before anything runs.

    Commands stream from the first driver command, but the suites frame used to
    wait for the first test to REPORT — so the tree stayed empty through the
    whole first test while the Actions list filled up beside it. Collection is
    the earliest point pytest knows the full shape; every item goes out pending
    and each one's state is corrected as it starts and finishes.
    """
    if not _opted_in():
        return
    capturer = devtools.get_capturer()
    if capturer is None:
        return
    items = getattr(session, "items", []) or []
    for item in items:
        file, line, name = item.location
        _registry.record(
            item.nodeid, file, name, line or 0, "pending",
            abs_file=_absolute(file),
        )
    _publish(capturer)
    _report_passing_assertion_support(items)


def _report_passing_assertion_support(items) -> None:  # noqa: ANN001
    """Say so when passing assertions will not be captured.

    Whether the pass hook is live is decided by what pytest COMPILED into each
    test, and the option that controls it is read while modules are rewritten —
    so a run can end up with failing rows only. That is indistinguishable from a
    test that simply asserted nothing, which is why it is stated rather than left
    to be inferred from an empty timeline.

    Read off the bytecode instead of the option: the option is what was asked
    for, the bytecode is what happened.
    """
    for item in items:
        function = getattr(item, "function", None)
        code = getattr(function, "__code__", None)
        if code is None:
            continue
        if "_call_assertion_pass" not in code.co_names:
            _log.warning(
                "passing assertions will not appear as rows — pytest loaded %s "
                "from bytecode it rewrote before this was enabled. Failing "
                "assertions are unaffected. Delete the cached bytecode and "
                "re-run: %s",
                item.nodeid,
                _bytecode_cache_hint(),
            )
        return  # one test is enough: the whole run is rewritten the same way


def _bytecode_cache_hint() -> str:
    """Where to delete rewritten bytecode, for THIS interpreter.

    Not always ``__pycache__`` beside the file: with ``sys.pycache_prefix`` set —
    which macOS's system python does by default — every rewritten module goes to
    one central tree instead, and clearing the directory next to the test does
    nothing. Naming the wrong path is worse than naming none, because the reader
    follows it, sees no change, and concludes the advice was wrong rather than
    the location.
    """
    prefix = getattr(sys, "pycache_prefix", None)
    if prefix:
        return f"rm -rf {prefix!s} (sys.pycache_prefix is set)"
    return "find . -name __pycache__ -type d -exec rm -rf {} +"


def pytest_runtest_logstart(nodeid, location) -> None:  # noqa: ANN001
    if not _opted_in():
        return
    _registry.mark_start(nodeid)
    capturer = devtools.get_capturer()
    if capturer is None:
        return
    # Flip this one to running so the tree shows WHICH test is executing, not
    # just that something is.
    file, line, name = location
    _registry.record(
        nodeid, file, name, line or 0, "running", abs_file=_absolute(file)
    )
    _publish(capturer)


def reported_state(report) -> Optional[str]:  # noqa: ANN001
    """The terminal state a report carries, or None when it must not change the
    test's state.

    pytest reports three phases per test, and only `call` carries an outcome in
    the ordinary case. The other two matter when they FAIL: a failed setup means
    the test never ran (pytest calls it an error) and no `call` report ever
    arrives, so acting only on `call` left it running for the rest of the
    session; a failed teardown means the body passed but its fixture teardown
    broke, which is a failure pytest reports and the tree would otherwise show
    green.

    Passing setup and teardown reports carry nothing: acting on a passing setup
    would mark a test passed before it ran, and acting on a passing teardown
    would overwrite a failed `call` with its clean teardown.
    """
    if report.when == "call":
        if report.skipped:
            return "skipped"
        return "passed" if report.passed else "failed"
    if report.when == "setup" and report.skipped:
        return "skipped"
    if report.failed:  # setup or teardown error
        return "failed"
    return None


def pytest_runtest_logreport(report) -> None:  # noqa: ANN001
    if not _opted_in():
        return
    capturer = devtools.get_capturer()
    if capturer is None:
        return
    state = reported_state(report)
    if state is None:
        return
    file, line, name = report.location
    _registry.record(
        report.nodeid, file, name, line or 0, state, abs_file=_absolute(file)
    )
    _publish(capturer)


def pytest_assertrepr_compare(config, op, left, right):  # noqa: ANN001, ANN201
    """Record the operands pytest just compared, and change nothing.

    Returning None leaves pytest's own failure formatting untouched — this hook
    exists to explain a comparison, and hijacking it would rewrite the terminal
    output as a side effect of capture.
    """
    if _opted_in():
        _comparisons.record(op, left, right)
    return None


def pytest_assertion_pass(item, lineno, orig, expl) -> None:  # noqa: ANN001
    """Emit a row for an assertion that HELD.

    Fires only because `_enable_assertion_pass_hook` turned the option on. The
    operands arrive separately, through `pytest_assertrepr_compare` immediately
    before this — a non-comparison assertion (`assert x`) has none, and the row
    then carries its source text and outcome alone.
    """
    if not _opted_in():
        return
    capturer = devtools.get_capturer()
    if capturer is None:
        return
    _emit_assertion(
        capturer,
        source=orig,
        comparison=_comparisons.take(),
        passed=True,
        location=_assertion_location(item, lineno),
    )


def pytest_exception_interact(node, call, report) -> None:  # noqa: ANN001
    """Emit a row for an assertion that FAILED.

    There is no per-assertion failure hook — a failing `assert` raises and the
    test ends — so the exception is the event. Restricted to AssertionError:
    every other exception is a test error that already surfaces as the test's
    own state, and turning one into an assertion row would invent an assertion
    the user never wrote.
    """
    if not _opted_in():
        return
    excinfo = getattr(call, "excinfo", None)
    if excinfo is None or not isinstance(
        getattr(excinfo, "value", None), AssertionError
    ):
        # A non-assertion failure must not walk off with buffered operands: the
        # next assertion would then report values from an unrelated comparison.
        _comparisons.clear()
        return
    capturer = devtools.get_capturer()
    if capturer is None:
        return
    location, source = _failing_assertion_site(excinfo)
    _emit_assertion(
        capturer,
        source=source,
        comparison=_comparisons.take(),
        passed=False,
        location=location,
        error=excinfo.value,
    )


def _failing_assertion_site(excinfo) -> tuple:  # noqa: ANN001
    """(``path:line``, source text) of the assert that raised, best effort.

    The pass hook is handed the original expression; a failure is not, so it is
    read back from the traceback's innermost frame. Both halves degrade to None
    independently — a row with no source text is still a row with a result.
    """
    try:
        entry = excinfo.traceback[-1]
        path = str(getattr(entry, "path", "") or "")
        lineno = getattr(entry, "lineno", None)
        location = f"{path}:{lineno + 1}" if path and lineno is not None else None
        statement = str(getattr(entry, "statement", "") or "").strip()
        source = statement.removeprefix("assert ").strip() or None
        return location, source
    except Exception as exc:  # noqa: BLE001 — capture must never break the test
        _log.debug("could not locate the failing assertion: %s", exc)
        return None, None


def _assertion_location(item, lineno) -> Optional[str]:  # noqa: ANN001
    """`path:line` for the assertion, so the row links to the source.

    Built from the item rather than the stack: by the time a hook runs, the
    user's frame is gone, and `utils.call_source` would resolve to pytest's own
    internals.
    """
    path = getattr(item, "path", None) or getattr(item, "fspath", None)
    if path is None:
        return None
    return f"{path}:{lineno}"


def _emit_assertion(
    capturer,  # noqa: ANN001
    *,
    source: Optional[str],
    comparison: Optional[tuple],
    passed: bool,
    location: Optional[str],
    error: Optional[BaseException] = None,
) -> None:
    op, left, right = comparison if comparison else (None, None, None)
    now = now_ms()
    capturer.capture_command(
        command=assertions.ASSERT_COMMAND,
        args=[source] if source else [],
        result=assertions.collapsed_result(
            passed=passed, op=op, left=left, right=right
        ),
        error=error,
        start_time=now,
        call_source=location,
    )


def pytest_sessionfinish(session, exitstatus) -> None:  # noqa: ANN001
    if not _opted_in():
        return
    capturer = devtools.get_capturer()
    if capturer is not None:
        _publish(capturer)
    # Before the window wait: the archive belongs to the RUN, and everything
    # below this line is about the user's session with the dashboard. Blocking
    # it behind a window close would mean CI — which opens none — only ever got
    # the artifact during process teardown.
    devtools.export_trace()
    # Keep the dashboard open for inspection after the run — exit when the user
    # closes the window (clientDisconnected). Only when we actually opened a
    # window; CI (DEVTOOLS_OPEN=0) tears down immediately.
    from . import lifecycle

    if lifecycle.dashboard_window_open():
        print(
            "\n[devtools] dashboard is live — close the window to finish "
            "(Ctrl-C also works).\n"
        )
        lifecycle.wait_for_shutdown()
    devtools.disable()
