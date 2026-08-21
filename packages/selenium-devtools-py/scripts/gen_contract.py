#!/usr/bin/env python3
"""Generate ``_contract.py`` from ``packages/shared`` — the Python side of the
wire contract, derived from the single TS source of truth.

Runs only in the monorepo (dev time); the generated file is committed and ships
inside the wheel, so published installs need neither this script nor `shared`.

It doubles as a drift-guard: if a scope the adapter relies on disappears from
shared's ``TraceLog`` / ``WS_SCOPE``, generation fails loudly rather than
letting the Python side silently send a name the UI no longer understands.

Run:  python3 scripts/gen_contract.py
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

# The runner id this adapter reports as. Generated rather than hand-written so
# a rename in shared's TEST_RUNNER_IDS fails generation instead of silently
# shipping a value the app's `isTestRunnerId` narrows away — which degrades to
# the same fallbacks as sending nothing.
REQUIRED_RUNNER_ID = "selenium-webdriver"

# Data scopes the Python adapter emits — each must exist as a TraceLog key.
REQUIRED_DATA_SCOPES = {
    "SCOPE_METADATA": "metadata",
    "SCOPE_COMMANDS": "commands",
    "SCOPE_CONSOLE_LOGS": "consoleLogs",
    "SCOPE_NETWORK_REQUESTS": "networkRequests",
    "SCOPE_SUITES": "suites",
    "SCOPE_SCREENCAST": "screencast",
    "SCOPE_SOURCES": "sources",
    "SCOPE_MUTATIONS": "mutations",
}


def _repo_root() -> Path:
    for parent in Path(__file__).resolve().parents:
        if (parent / "packages" / "shared" / "package.json").exists():
            return parent
    raise SystemExit("could not locate the monorepo root (packages/shared)")


def _shared_version(shared: Path) -> str:
    pkg = json.loads((shared / "package.json").read_text())
    return pkg["version"]


def _trace_log_keys(types_ts: str) -> list[str]:
    m = re.search(r"export interface TraceLog \{(.*?)\n\}", types_ts, re.DOTALL)
    if not m:
        raise SystemExit("could not find `interface TraceLog` in shared/types.ts")
    return re.findall(r"^\s*(\w+)\??:", m.group(1), re.MULTILINE)


def _ws_scopes(routes_ts: str) -> dict[str, str]:
    m = re.search(r"export const WS_SCOPE = \{(.*?)\n\} as const", routes_ts, re.DOTALL)
    if not m:
        raise SystemExit("could not find `WS_SCOPE` in shared/routes.ts")
    return dict(re.findall(r"(\w+):\s*'([^']+)'", m.group(1)))


def _collector_path(collector_ts: str) -> str:
    """The route the backend serves the page-side collector from."""
    m = re.search(r"export const COLLECTOR_API = \{(.*?)\} as const", collector_ts, re.DOTALL)
    if not m:
        raise SystemExit("could not find `COLLECTOR_API` in shared/collector.ts")
    got = re.search(r"get:\s*'([^']+)'", m.group(1))
    if not got:
        raise SystemExit("`COLLECTOR_API` has no `get` route")
    return got.group(1)


def _collector_push(collector_ts: str) -> dict[str, str]:
    """The two names the page-side push path is wired through.

    Single-sourced in shared because three writers exist — core's preload
    wrapper, the collector that reads the global, and this adapter — and a name
    that drifts on one side is a silent loss of DOM replay: the collector keeps
    buffering, nothing ever arrives, and the preview panel looks exactly like a
    page that never changed.
    """
    names = {}
    for const in ("COLLECTOR_SINK_GLOBAL", "COLLECTOR_MUTATION_CHANNEL"):
        m = re.search(rf"export const {const} = '([^']+)'", collector_ts)
        if not m:
            raise SystemExit(f"could not find `{const}` in shared/collector.ts")
        names[const] = m.group(1)
    return names


def _worker_query(routes_ts: str) -> dict[str, str]:
    """Query-param names on the worker upgrade.

    Generated rather than written by hand for the same reason the scopes are:
    the backend decides whether to keep or wipe accumulated run state by reading
    these exact keys, and a name that drifts loses that state silently — every
    connect reads as a new run, which is indistinguishable from working.
    """
    m = re.search(
        r"export const WORKER_WS_QUERY = \{(.*?)\n\} as const", routes_ts, re.DOTALL
    )
    if not m:
        raise SystemExit("could not find `WORKER_WS_QUERY` in shared/routes.ts")
    return dict(re.findall(r"(\w+):\s*'([^']+)'", m.group(1)))


def _run_id_env(runner_ts: str) -> str:
    """The env var carrying run identity between a launcher and its workers."""
    m = re.search(r"RUN_ID:\s*'([^']+)'", runner_ts)
    if not m:
        raise SystemExit("could not find `RUNNER_ENV.RUN_ID` in shared/runner.ts")
    return m.group(1)


def _test_runner_ids(types_ts: str) -> list[str]:
    m = re.search(r"export const TEST_RUNNER_IDS = \[(.*?)\] as const", types_ts, re.DOTALL)
    if not m:
        raise SystemExit("could not find `TEST_RUNNER_IDS` in shared/types.ts")
    return re.findall(r"'([^']+)'", m.group(1))


def main() -> int:
    root = _repo_root()
    shared = root / "packages" / "shared"
    version = _shared_version(shared)
    types_ts = (shared / "src" / "types.ts").read_text()
    data_keys = _trace_log_keys(types_ts)
    runner_ids = _test_runner_ids(types_ts)
    collector_ts = (shared / "src" / "collector.ts").read_text()
    collector_path = _collector_path(collector_ts)
    push = _collector_push(collector_ts)
    routes_ts = (shared / "src" / "routes.ts").read_text()
    control = _ws_scopes(routes_ts)
    worker_query = _worker_query(routes_ts)
    run_id_env = _run_id_env((shared / "src" / "runner.ts").read_text())

    # Drift-guard.
    missing = [v for v in REQUIRED_DATA_SCOPES.values() if v not in data_keys]
    if missing:
        raise SystemExit(
            f"contract drift: scope(s) {missing} no longer in shared TraceLog "
            f"(present: {data_keys}). Update the adapter or shared."
        )

    if "runId" not in worker_query:
        raise SystemExit(
            "contract drift: `runId` is no longer a key of shared "
            f"WORKER_WS_QUERY (present: {sorted(worker_query)}). The worker "
            "socket carries it, and without it every connect reads as a new run."
        )

    if REQUIRED_RUNNER_ID not in runner_ids:
        raise SystemExit(
            f"contract drift: runner id {REQUIRED_RUNNER_ID!r} is no longer in "
            f"shared TEST_RUNNER_IDS (present: {runner_ids}). Update the adapter "
            "or shared."
        )

    lines = [
        "# GENERATED by scripts/gen_contract.py from packages/shared.",
        "# Do not edit by hand — run the script to regenerate.",
        f'CONTRACT_VERSION = "{version}"',
        "",
    ]
    for const, value in REQUIRED_DATA_SCOPES.items():
        lines.append(f'{const} = "{value}"')
    lines += [
        "",
        f"DATA_SCOPES = frozenset({sorted(data_keys)!r})",
        f"CONTROL_SCOPES = frozenset({sorted(control.values())!r})",
        "",
        f'COLLECTOR_PATH = "{collector_path}"',
        f'COLLECTOR_SINK_GLOBAL = "{push["COLLECTOR_SINK_GLOBAL"]}"',
        f'COLLECTOR_MUTATION_CHANNEL = "{push["COLLECTOR_MUTATION_CHANNEL"]}"',
        f'RUNNER_ID = "{REQUIRED_RUNNER_ID}"',
        f"TEST_RUNNER_IDS = frozenset({sorted(runner_ids)!r})",
        "",
        f'WORKER_QUERY_RUN_ID = "{worker_query["runId"]}"',
        f'ENV_RUN_ID = "{run_id_env}"',
        "",
    ]
    out = shared.parent / "selenium-devtools-py" / "src" / "selenium_devtools" / "_contract.py"
    out.write_text("\n".join(lines))
    print(f"wrote {out.relative_to(root)}  (contract v{version}, "
          f"{len(data_keys)} data scopes, {len(control)} control scopes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
