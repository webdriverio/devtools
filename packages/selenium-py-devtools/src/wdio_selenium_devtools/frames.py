"""Builders for the wire frames the dashboard renders.

Each function returns the ``data`` payload for a ``{scope, data}`` frame.
Shapes mirror ``packages/shared/src/types.ts`` and are pinned by the Phase-0
golden frames (see examples/python-spike). Keeping them here — pure and
side-effect free — makes them unit-testable and the single place the contract
lives on the Python side.
"""

from __future__ import annotations

from typing import Any, List, Optional

from .types import CommandLog, ConsoleLog, Metadata, NetworkRequest, SuiteStats, TestStats
from .utils import iso


def metadata(
    session_id: str,
    capabilities: Optional[dict] = None,
    url: Optional[str] = None,
) -> Metadata:
    caps = capabilities or {}
    return {
        "type": "testrunner",  # TraceType.Testrunner
        "sessionId": session_id,
        "url": url,
        "capabilities": caps,
        "desiredCapabilities": caps,
        "testEnv": "python-selenium",
    }


def command_log(
    *,
    command: str,
    args: List[Any],
    result: Any = None,
    error: Optional[BaseException] = None,
    timestamp: int,
    start_time: int,
    call_source: Optional[str],
    command_id: int,
) -> CommandLog:
    entry: CommandLog = {
        "command": command,
        "args": args,
        "result": result,
        "timestamp": timestamp,
        "startTime": start_time,
        "callSource": call_source,
        "id": command_id,
    }
    if error is not None:
        entry["error"] = {
            "name": type(error).__name__,
            "message": str(error),
        }
    return entry


def console_log(
    *, level: str, args: List[Any], timestamp: int, source: str = "browser"
) -> ConsoleLog:
    return {"type": level, "args": args, "timestamp": timestamp, "source": source}


def network_request(
    *,
    request_id: str,
    url: str,
    method: str,
    status: Optional[int],
    timestamp: int,
    start_time: int,
    request_type: str = "fetch",
    end_time: Optional[int] = None,
) -> NetworkRequest:
    return {
        "id": request_id,
        "url": url,
        "method": method,
        "status": status,
        "timestamp": timestamp,
        "startTime": start_time,
        "endTime": end_time,
        "type": request_type,
    }


def test_stats(
    *,
    uid: str,
    title: str,
    full_title: str,
    parent: str,
    state: str,
    file: str,
    start_ms: int,
    end_ms: int,
    call_source: Optional[str] = None,
) -> TestStats:
    return {
        "uid": uid,
        "cid": "0-0",
        "title": title,
        "fullTitle": full_title,
        "parent": parent,
        "state": state,
        "start": iso(start_ms),
        "end": iso(end_ms),
        "type": "test",
        "file": file,
        "retries": 0,
        "_duration": max(0, end_ms - start_ms),
        "callSource": call_source,
    }


def suite_stats(
    *,
    uid: str,
    title: str,
    file: str,
    start_ms: int,
    tests: List[TestStats],
    end_ms: Optional[int] = None,
    state: Optional[str] = None,
) -> SuiteStats:
    return {
        "uid": uid,
        "cid": "0-0",
        "title": title,
        "fullTitle": title,
        "type": "suite",
        "file": file,
        "start": iso(start_ms),
        "end": iso(end_ms) if end_ms is not None else None,
        "state": state,
        "tests": tests,
        "suites": [],
        "hooks": [],
        "_duration": max(0, (end_ms - start_ms)) if end_ms is not None else 0,
    }
