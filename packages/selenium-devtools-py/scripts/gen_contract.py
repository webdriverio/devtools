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
import keyword
import re
import sys
from pathlib import Path

# The runner id this adapter reports as. Generated rather than hand-written so
# a rename in shared's TEST_RUNNER_IDS fails generation instead of silently
# shipping a value the app's `isTestRunnerId` narrows away — which degrades to
# the same fallbacks as sending nothing.
REQUIRED_RUNNER_ID = "selenium-webdriver"

# Control scopes the adapter SENDS (as opposed to receives). Generated for the
# same reason the data scopes are: a renamed scope is silent — the frame is
# delivered and dropped, so a command row simply never updates.
REQUIRED_CONTROL_SCOPES = {
    "SCOPE_REPLACE_COMMAND": "replaceCommand",
}

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
    # The dense filmstrip. The JS adapters hand their recorder's buffer to the
    # exporter in-process; an adapter exporting through the backend sends it.
    "SCOPE_SCREENCAST_FRAMES": "screencastFrames",
    # Per-action element trees — what the trace's A11y tab reads.
    "SCOPE_ACTION_SNAPSHOTS": "actionSnapshots",
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


def _trace_export_scopes(trace_export_ts: str) -> dict[str, str]:
    """`TRACE_EXPORT_SCOPE` — the worker↔backend frames that ask the backend to
    build a trace and answer with where it landed. Python cannot run the
    transforms itself, so these two strings are the whole route to a trace."""
    m = re.search(
        r"export const TRACE_EXPORT_SCOPE = \{(.*?)\n\} as const",
        trace_export_ts,
        re.DOTALL,
    )
    if not m:
        raise SystemExit(
            "could not find `TRACE_EXPORT_SCOPE` in shared/trace-export.ts"
        )
    return dict(re.findall(r"(\w+):\s*'([^']+)'", m.group(1)))


def _element_scripts_path(element_scripts_ts: str) -> str:
    """`ELEMENT_SCRIPTS_API.get` — where the backend serves the page-side
    element scripts. Python cannot import them; this route is the only way it
    reaches the code that fills the A11y tab."""
    m = re.search(
        r"export const ELEMENT_SCRIPTS_API = \{(.*?)\n\} as const",
        element_scripts_ts,
        re.DOTALL,
    )
    if not m:
        raise SystemExit(
            "could not find `ELEMENT_SCRIPTS_API` in shared/element-scripts.ts"
        )
    got = re.search(r"get:\s*'([^']+)'", m.group(1))
    if not got:
        raise SystemExit("`ELEMENT_SCRIPTS_API` has no `get` path")
    return got.group(1)


def _collector_path(collector_ts: str) -> str:
    """The route the backend serves the page-side collector from."""
    m = re.search(r"export const COLLECTOR_API = \{(.*?)\} as const", collector_ts, re.DOTALL)
    if not m:
        raise SystemExit("could not find `COLLECTOR_API` in shared/collector.ts")
    got = re.search(r"get:\s*'([^']+)'", m.group(1))
    if not got:
        raise SystemExit("`COLLECTOR_API` has no `get` route")
    return got.group(1)


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


def _rerun_slot(runner_ts: str) -> dict[str, str]:
    """Slots the backend substitutes into a ``rerunCommand``.

    Generated because the adapter WRITES the slot and the backend READS it. A
    drifted name is not a type error on either side: the template keeps a
    literal ``{{...}}``, the shell hands it to pytest as a file name, and the
    rerun fails as a collection error naming a path nobody wrote.
    """
    m = re.search(
        r"export const RERUN_SLOT = \{(.*?)\n\} as const", runner_ts, re.DOTALL
    )
    if not m:
        raise SystemExit("could not find `RERUN_SLOT` in shared/runner.ts")
    return dict(re.findall(r"(\w+):\s*'([^']+)'", m.group(1)))


def _reuse_env(runner_ts: str) -> dict[str, str]:
    """Env vars the backend sets on a rerun child to point it at itself.

    Generated because only the backend writes them and only an adapter reads
    them. A name that drifts is silent in the worst way: the child launches a
    SECOND dashboard and reports into it, so the rerun looks like it worked
    while the window the user clicked in stays empty.
    """
    m = re.search(
        r"export const REUSE_ENV = \{(.*?)\n\} as const", runner_ts, re.DOTALL
    )
    if not m:
        raise SystemExit("could not find `REUSE_ENV` in shared/runner.ts")
    return dict(re.findall(r"(\w+):\s*'([^']+)'", m.group(1)))


def _runner_cwd_env(runner_ts: str) -> str:
    """The env var naming the directory the backend spawns a rerun in."""
    m = re.search(r"RUNNER_CWD:\s*'([^']+)'", runner_ts)
    if not m:
        raise SystemExit("could not find `RUNNER_ENV.RUNNER_CWD` in shared/runner.ts")
    return m.group(1)


def _test_runner_ids(types_ts: str) -> list[str]:
    m = re.search(r"export const TEST_RUNNER_IDS = \[(.*?)\] as const", types_ts, re.DOTALL)
    if not m:
        raise SystemExit("could not find `TEST_RUNNER_IDS` in shared/types.ts")
    return re.findall(r"'([^']+)'", m.group(1))


def _native_platforms(device_ts: str) -> list[str]:
    m = re.search(r"export const NATIVE_PLATFORMS = \[(.*?)\] as const", device_ts, re.DOTALL)
    if not m:
        raise SystemExit("could not find `NATIVE_PLATFORMS` in shared/device.ts")
    return re.findall(r"'([^']+)'", m.group(1))


class _TypedDictWriter:
    """Renders ``wire-schema.json``'s ``$defs`` as TypedDicts.

    Required and optional keys are split across a base class and a
    ``total=False`` subclass because ``typing.Required`` needs Python 3.11 and
    the package supports 3.10. An inline object becomes a class named after its
    owner and key, since a TypedDict field cannot hold an anonymous shape.
    """

    def __init__(self, defs: dict) -> None:
        self._defs = defs
        self._classes: dict[str, str] = {}

    def render(self) -> str:
        for name, schema in self._defs.items():
            self._class(name, schema)
        names = sorted(self._classes)
        lines = [
            "# GENERATED by scripts/gen_contract.py from packages/shared/wire-schema.json.",
            "# Do not edit by hand — run the script to regenerate.",
            "from __future__ import annotations",
            "",
            "from typing import Any, Dict, List, Literal, Optional, TypedDict, Union",
            "",
            f"__all__ = {names!r}",
        ]
        for name in names:
            lines += ["", "", self._classes[name]]
        return "\n".join(lines) + "\n"

    def _class(self, name: str, schema: dict) -> None:
        if name in self._classes:
            raise SystemExit(f"wire schema: two shapes both want the name {name}")
        self._classes[name] = ""
        props = schema.get("properties", {})
        required = set(schema.get("required", []))
        fields = {}
        for key, prop in props.items():
            if not key.isidentifier() or keyword.iskeyword(key):
                raise SystemExit(f"wire schema: {name}.{key} is not a Python identifier")
            fields[key] = self._type(prop, name + key[:1].upper() + key[1:])
        req = [f"    {k}: {t}" for k, t in fields.items() if k in required]
        opt = [f"    {k}: {t}" for k, t in fields.items() if k not in required]
        if req and opt:
            body = (
                f"class _{name}Required(TypedDict):\n" + "\n".join(req) + "\n\n\n"
                f"class {name}(_{name}Required, total=False):\n" + "\n".join(opt)
            )
        elif req:
            body = f"class {name}(TypedDict):\n" + "\n".join(req)
        else:
            body = f"class {name}(TypedDict, total=False):\n" + ("\n".join(opt) or "    pass")
        self._classes[name] = body

    def _type(self, schema: dict, inline_name: str) -> str:
        if "$ref" in schema:
            return schema["$ref"].rsplit("/", 1)[-1]
        if "anyOf" in schema:
            parts = [self._type(s, inline_name) for s in schema["anyOf"]]
            rest = [p for p in parts if p != "None"]
            inner = rest[0] if len(rest) == 1 else f"Union[{', '.join(rest)}]"
            return f"Optional[{inner}]" if len(rest) < len(parts) else inner
        if "enum" in schema:
            return f"Literal[{', '.join(repr(v) for v in schema['enum'])}]"
        if "const" in schema:
            return f"Literal[{schema['const']!r}]"
        kind = schema.get("type")
        if kind is None:
            return "Any"
        if kind == "array":
            return f"List[{self._type(schema['items'], inline_name)}]"
        if kind == "object":
            if "properties" in schema:
                self._class(inline_name, schema)
                return inline_name
            extra = schema.get("additionalProperties")
            value = self._type(extra, inline_name) if isinstance(extra, dict) else "Any"
            return f"Dict[str, {value}]"
        primitives = {"string": "str", "number": "float", "boolean": "bool", "null": "None"}
        if kind not in primitives:
            raise SystemExit(f"wire schema: unsupported type {kind!r} for {inline_name}")
        return primitives[kind]


def _wire_types(schema_path: Path) -> str:
    if not schema_path.exists():
        raise SystemExit(
            f"{schema_path} is missing: run `pnpm --filter @wdio/devtools-shared gen:wire-schema`"
        )
    return _TypedDictWriter(json.loads(schema_path.read_text())["$defs"]).render()


def main() -> int:
    root = _repo_root()
    shared = root / "packages" / "shared"
    version = _shared_version(shared)
    types_ts = (shared / "src" / "types.ts").read_text()
    data_keys = _trace_log_keys(types_ts)
    runner_ids = _test_runner_ids(types_ts)
    collector_path = _collector_path((shared / "src" / "collector.ts").read_text())
    element_scripts_path = _element_scripts_path(
        (shared / "src" / "element-scripts.ts").read_text()
    )
    trace_export = _trace_export_scopes(
        (shared / "src" / "trace-export.ts").read_text()
    )
    routes_ts = (shared / "src" / "routes.ts").read_text()
    control = _ws_scopes(routes_ts)
    worker_query = _worker_query(routes_ts)
    native_platforms = _native_platforms((shared / "src" / "device.ts").read_text())
    runner_ts = (shared / "src" / "runner.ts").read_text()
    run_id_env = _run_id_env(runner_ts)
    rerun_slot = _rerun_slot(runner_ts)
    runner_cwd_env = _runner_cwd_env(runner_ts)
    reuse_env = _reuse_env(runner_ts)

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

    missing_control = [
        v for v in REQUIRED_CONTROL_SCOPES.values() if v not in control.values()
    ]
    if missing_control:
        raise SystemExit(
            f"contract drift: control scope(s) {missing_control} no longer in "
            f"shared WS_SCOPE (present: {sorted(control.values())})."
        )

    if "testId" not in rerun_slot:
        raise SystemExit(
            "contract drift: `testId` is no longer a key of shared RERUN_SLOT "
            f"(present: {sorted(rerun_slot)}). The rerun template selects by "
            "pytest nodeid, and no other slot is substituted verbatim."
        )

    missing_reuse = [
        k
        for k in ("REUSE", "HOST", "PORT", "LAUNCH_COMMAND")
        if k not in reuse_env
    ]
    if missing_reuse:
        raise SystemExit(
            f"contract drift: REUSE_ENV key(s) {missing_reuse} no longer in "
            f"shared (present: {sorted(reuse_env)}). REUSE/HOST/PORT are how "
            "a rerun child reports into the dashboard that launched it, and "
            "LAUNCH_COMMAND is how it publishes a Run-all that is not "
            "narrowed to the one test it was spawned for."
        )

    missing_export = [k for k in ("request", "result") if k not in trace_export]
    if missing_export:
        raise SystemExit(
            f"contract drift: TRACE_EXPORT_SCOPE key(s) {missing_export} no "
            f"longer in shared (present: {sorted(trace_export)}). Python has no "
            "other route to a trace — it cannot run the transforms itself."
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
    for const, value in REQUIRED_CONTROL_SCOPES.items():
        lines.append(f'{const} = "{value}"')
    lines += [
        "",
        f"DATA_SCOPES = frozenset({sorted(data_keys)!r})",
        f"CONTROL_SCOPES = frozenset({sorted(control.values())!r})",
        "",
        f'COLLECTOR_PATH = "{collector_path}"',
        f'ELEMENT_SCRIPTS_PATH = "{element_scripts_path}"',
        f'RUNNER_ID = "{REQUIRED_RUNNER_ID}"',
        f"TEST_RUNNER_IDS = frozenset({sorted(runner_ids)!r})",
        f"NATIVE_PLATFORMS = frozenset({sorted(native_platforms)!r})",
        "",
        f'WORKER_QUERY_RUN_ID = "{worker_query["runId"]}"',
        f'ENV_RUN_ID = "{run_id_env}"',
        "",
        f'RERUN_SLOT_TEST_ID = "{rerun_slot["testId"]}"',
        f'ENV_RUNNER_CWD = "{runner_cwd_env}"',
        "",
        f'SCOPE_TRACE_EXPORT = "{trace_export["request"]}"',
        f'SCOPE_TRACE_EXPORTED = "{trace_export["result"]}"',
        "",
        f'ENV_REUSE = "{reuse_env["REUSE"]}"',
        f'ENV_REUSE_HOST = "{reuse_env["HOST"]}"',
        f'ENV_REUSE_PORT = "{reuse_env["PORT"]}"',
        f'ENV_LAUNCH_COMMAND = "{reuse_env["LAUNCH_COMMAND"]}"',
        "",
    ]
    pkg = shared.parent / "selenium-devtools-py" / "src" / "selenium_devtools"
    out = pkg / "_contract.py"
    out.write_text("\n".join(lines))
    print(f"wrote {out.relative_to(root)}  (contract v{version}, "
          f"{len(data_keys)} data scopes, {len(control)} control scopes)")
    wire = pkg / "_wire_types.py"
    wire.write_text(_wire_types(shared / "wire-schema.json"))
    print(f"wrote {wire.relative_to(root)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
