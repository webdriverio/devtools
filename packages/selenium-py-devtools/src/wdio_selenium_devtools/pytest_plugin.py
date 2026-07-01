"""pytest plugin — feeds the suite/test tree to the dashboard.

The analogue of the JS adapter's mocha/jest hooks. Inert unless the run opts in
via ``WDIO_DEVTOOLS=1`` or ``DEVTOOLS_PORT=...`` so installing the package never
hijacks an unrelated pytest run. On opt-in it enables capture at session start,
stamps per-test timing, and re-sends the ``suites`` frame as each test reports.
"""

from __future__ import annotations

import os
from typing import Dict

import wdio_selenium_devtools as devtools
from . import frames
from .constants import ENV_OPT_IN, ENV_PORT
from .utils import now_ms


def _opted_in() -> bool:
    return bool(os.environ.get(ENV_OPT_IN) or os.environ.get(ENV_PORT))


class _SuiteRegistry:
    """Groups tests by file into the SuiteStats[] the dashboard expects."""

    def __init__(self) -> None:
        self._suites: Dict[str, dict] = {}
        self._tests: Dict[str, dict] = {}
        self._starts: Dict[str, int] = {}

    def mark_start(self, nodeid: str) -> None:
        self._starts.setdefault(nodeid, now_ms())

    def record(self, nodeid: str, file: str, name: str, line: int, state: str) -> None:
        start = self._starts.get(nodeid, now_ms())
        end = now_ms()
        suite = self._suites.setdefault(
            file,
            frames.suite_stats(uid=file, title=file, file=file,
                               start_ms=start, tests=[]),
        )
        self._tests[nodeid] = frames.test_stats(
            uid=nodeid,
            title=name,
            full_title=f"{file} › {name}",
            parent=file,
            state=state,
            file=file,
            start_ms=start,
            end_ms=end,
            call_source=f"{file}:{line + 1}",
        )
        suite["tests"] = [t for nid, t in self._tests.items()
                          if nid.split("::", 1)[0] == file]
        suite["end"] = self._tests[nodeid]["end"]
        suite["state"] = "failed" if any(
            t["state"] == "failed" for t in suite["tests"]
        ) else state

    def snapshot(self) -> list:
        return list(self._suites.values())


_registry = _SuiteRegistry()


def pytest_configure(config) -> None:  # noqa: ANN001
    if _opted_in():
        devtools.enable()


def pytest_runtest_logstart(nodeid, location) -> None:  # noqa: ANN001
    if _opted_in():
        _registry.mark_start(nodeid)


def pytest_runtest_logreport(report) -> None:  # noqa: ANN001
    if not _opted_in():
        return
    capturer = devtools.get_capturer()
    if capturer is None:
        return
    # 'call' carries pass/fail; a skip surfaces at 'setup'.
    if report.when == "call" or (report.when == "setup" and report.skipped):
        state = (
            "skipped" if report.skipped
            else "passed" if report.passed
            else "failed"
        )
        file, line, name = report.location
        _registry.record(report.nodeid, file, name, line or 0, state)
        capturer.send_suites(_registry.snapshot())


def pytest_sessionfinish(session, exitstatus) -> None:  # noqa: ANN001
    if not _opted_in():
        return
    capturer = devtools.get_capturer()
    if capturer is not None:
        capturer.send_suites(_registry.snapshot())
    devtools.disable()
