"""pytest plugin — feeds the suite/test tree to the dashboard.

The analogue of the JS adapter's mocha/jest hooks. Inert unless the run opts in
via ``DEVTOOLS_ENABLE=1`` or ``DEVTOOLS_PORT=...`` so installing the package never
hijacks an unrelated pytest run. On opt-in it enables capture at session start,
stamps per-test timing, and re-sends the ``suites`` frame as each test reports.
"""

from __future__ import annotations

import os
from typing import Dict, Optional

import selenium_devtools as devtools
from . import frames
from .constants import ENV_OPT_IN, ENV_PORT
from .utils import now_ms


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
        # Collection index per nodeid. pytest runs in collection order and
        # interleaves module-level tests with classes, which the tree's default
        # (a suite's own tests, then its nested suites) cannot express.
        self._order: Dict[str, int] = {}

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
        order: Optional[int] = None,
    ) -> None:
        # `file` is pytest's rootdir-relative path: it prefixes every nodeid, so
        # it stays the grouping key and the readable title. `abs_file` is the
        # same file resolved absolutely, and is what goes on the wire — the
        # `sources` map is keyed by each command's absolute callSource, and the
        # app pairs the two by exact path, so a relative one leaves the Source
        # tab reporting the file as never captured the moment a test is picked.
        path = abs_file or file
        if order is not None:
            self._order[nodeid] = order
        position = self._order.get(nodeid)
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


def pytest_configure(config) -> None:  # noqa: ANN001
    if _opted_in():
        global _rootdir
        # `rootpath` on pytest 7+, `rootdir` before it.
        root = getattr(config, "rootpath", None) or getattr(config, "rootdir", None)
        _rootdir = str(root) if root else None
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
    for index, item in enumerate(getattr(session, "items", []) or []):
        file, line, name = item.location
        _registry.record(
            item.nodeid, file, name, line or 0, "pending",
            abs_file=_absolute(file), order=index,
        )
    _publish(capturer)


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


def pytest_sessionfinish(session, exitstatus) -> None:  # noqa: ANN001
    if not _opted_in():
        return
    capturer = devtools.get_capturer()
    if capturer is not None:
        _publish(capturer)
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
