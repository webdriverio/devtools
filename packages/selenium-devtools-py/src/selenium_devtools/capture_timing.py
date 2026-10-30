"""Opt-in timing of per-action trace captures, in the format the JS adapters
write (``packages/shared/src/capture-timing.ts``), summarised by the same rules
as ``packages/core/src/capture-timing.ts``; ``mirror-vectors.json`` holds both
to one answer."""

from __future__ import annotations

import json
import logging
import math
import os
import sys
import time
from typing import Any, Callable, Dict, List, Optional, TypeVar

from .constants import ENV_CAPTURE_TIMING, LOGGER_NAME

_log = logging.getLogger(LOGGER_NAME + ".capture_timing")

T = TypeVar("T")

PROBES = (
    "url",
    "title",
    "pageSource",
    "accessibilityTree",
    "elements",
    "screenshot",
    "process",
)
TRIGGERS = ("action", "wait-poll", "matcher-poll", "final")
HEADER = (
    "ms = issue to settle; the driver serves one request at a time, so svc "
    "(settle minus the previous probe's settle) is a probe's own cost and the "
    "rest is queueing"
)
COLUMNS = ("n", "total", "median", "p95", "max", "svc total", "svc median")

_pending: List[Dict[str, Any]] = []
_window_start_ms = time.time() * 1000


def enabled() -> bool:
    """Read per capture, so a test or a long-lived process can flip it."""
    value = os.environ.get(ENV_CAPTURE_TIMING, "").strip().lower()
    return value not in ("", "0", "false", "no", "off")


def file_name(pid: int) -> str:
    return f"capture-timing-{pid}.ndjson"


# Half up, as JavaScript's Math.round is; Python's round() is half to even.
def _round_half_up(value: float) -> int:
    return math.floor(value + 0.5)


def _round(ms: float) -> float:
    return _round_half_up(ms * 10) / 10


def _one_decimal(value: float) -> str:
    return f"{_round_half_up(value * 10) / 10:.1f}"


def _is_empty(value: Any) -> bool:
    return value is None or value == "" or (isinstance(value, list) and not value)


class CaptureTimer:
    """Times the reads of one capture. This adapter issues them one after
    another, so a probe's service time is its own duration."""

    def __init__(self, command: str, trigger: str, native: bool) -> None:
        self.command = command
        self.trigger = trigger
        self.native = native
        self._start_ms = time.time() * 1000
        self._t0 = time.perf_counter()
        self._probes: List[Dict[str, Any]] = []

    def _elapsed(self) -> float:
        return (time.perf_counter() - self._t0) * 1000

    def read(self, probe: str, fn: Callable[..., T], *args: Any) -> T:
        issued = self._elapsed()
        value = None
        try:
            value = fn(*args)
            return value
        finally:
            self._probes.append(
                {
                    "probe": probe,
                    "issued": issued,
                    "settled": self._elapsed(),
                    "empty": _is_empty(value),
                }
            )

    def finish(self) -> None:
        total = self._elapsed()
        probes = []
        previous_settled = 0.0
        for p in self._probes:
            probes.append(
                {
                    "probe": p["probe"],
                    "issued": _round(p["issued"]),
                    "settled": _round(p["settled"]),
                    "service": _round(
                        max(0.0, p["settled"] - max(p["issued"], previous_settled))
                    ),
                    "empty": p["empty"],
                }
            )
            previous_settled = p["settled"]
        _pending.append(
            {
                "command": self.command,
                "trigger": self.trigger,
                "native": self.native,
                "start": int(self._start_ms),
                "total": _round(total),
                "probes": probes,
            }
        )


def _median(values: List[float]) -> float:
    mid = len(values) // 2
    return values[mid] if len(values) % 2 else (values[mid - 1] + values[mid]) / 2


def _percentile(values: List[float], p: float) -> float:
    """Nearest rank, so every reported value is one that was measured."""
    return values[max(0, math.ceil((p / 100) * len(values)) - 1)]


def _total(values: List[float]) -> float:
    acc = 0.0
    for v in values:
        acc += v
    return acc


def _stat_row(probe: str, durations: List[float], services: List[float]) -> Dict[str, Any]:
    d = sorted(durations)
    s = sorted(services)
    return {
        "probe": probe,
        "count": len(d),
        "total": _round(_total(d)),
        "median": _round(_median(d)),
        "p95": _round(_percentile(d, 95)),
        "max": _round(d[-1]),
        "serviceTotal": _round(_total(s)),
        "serviceMedian": _round(_median(s)),
    }


def _busy(records: List[Dict[str, Any]]) -> float:
    busy = 0.0
    end = -math.inf
    for start_ms, stop_ms in sorted(
        ((r["start"], r["start"] + r["total"]) for r in records), key=lambda s: s[0]
    ):
        busy += max(0.0, stop_ms - max(start_ms, end))
        end = max(end, stop_ms)
    return _round(busy)


def summarize(records: List[Dict[str, Any]], wall: Optional[float] = None) -> Dict[str, Any]:
    rows = []
    for probe in PROBES:
        timings = [p for r in records for p in r["probes"] if p["probe"] == probe]
        if timings:
            rows.append(
                _stat_row(
                    probe,
                    [p["settled"] - p["issued"] for p in timings],
                    [p["service"] for p in timings],
                )
            )
    if records:
        totals = [r["total"] for r in records]
        rows.append(_stat_row("capture", totals, totals))
    triggers = []
    for trigger in TRIGGERS:
        of = [r["total"] for r in records if r["trigger"] == trigger]
        if of:
            triggers.append({"trigger": trigger, "count": len(of), "total": _round(_total(of))})
    summary: Dict[str, Any] = {
        "captures": len(records),
        "native": sum(1 for r in records if r["native"]),
        "triggers": triggers,
        "rows": rows,
        "busy": _busy(records),
    }
    if wall is not None:
        summary["wall"] = _round(wall)
    return summary


def format_summary(summary: Dict[str, Any], file: Optional[str] = None) -> str:
    triggers = ", ".join(f"{t['trigger']} {t['count']}" for t in summary["triggers"])
    wall = summary.get("wall")
    share = (
        f" of {_one_decimal(wall / 1000)} s wall ({_one_decimal(summary['busy'] / wall * 100)}%)"
        if wall
        else ""
    )
    table = [["probe (ms)", *COLUMNS]] + [
        [
            r["probe"],
            *(
                str(_round_half_up(r[k]))
                for k in ("count", "total", "median", "p95", "max", "serviceTotal", "serviceMedian")
            ),
        ]
        for r in summary["rows"]
    ]
    widths = [max(len(row[i]) for row in table) for i in range(len(table[0]))]
    lines = [
        "  ".join(
            cell.ljust(widths[i]) if i == 0 else cell.rjust(widths[i]) for i, cell in enumerate(row)
        )
        for row in table
    ]
    head = (
        f"[devtools] capture timing: {summary['captures']} captures "
        f"({summary['native']} native{'; ' + triggers if triggers else ''}), busy {_one_decimal(summary['busy'] / 1000)} s{share}"
    )
    return "\n".join([head, HEADER, *lines, *([f"raw records: {file}"] if file else [])])


def _stderr_write(text: str) -> None:
    # sys.__stderr__, because pytest still has sys.stderr captured when the trace is exported.
    stream = sys.__stderr__ or sys.stderr
    stream.write(text)
    stream.flush()


def report(output_dir: str, write: Callable[[str], Any] = _stderr_write) -> Optional[str]:
    """Append the captures since the last report to this process's NDJSON file
    and print their summary. Never raises."""
    global _window_start_ms
    if not _pending:
        return None
    records = _pending[:]
    del _pending[:]
    now = time.time() * 1000
    wall = now - _window_start_ms
    _window_start_ms = now
    path = os.path.join(output_dir, file_name(os.getpid()))
    written: Optional[str] = None
    try:
        os.makedirs(output_dir, exist_ok=True)
        with open(path, "a", encoding="utf-8") as fh:
            for r in records:
                fh.write(json.dumps(r, separators=(",", ":")) + "\n")
        written = path
    except OSError as exc:
        write(f"[devtools] could not write {path}: {exc}\n")
    try:
        write(format_summary(summarize(records, wall), written) + "\n")
    except Exception as exc:  # noqa: BLE001 (a diagnostic must never fail the run)
        _log.debug("could not print the capture timing summary: %s", exc)
    return written
