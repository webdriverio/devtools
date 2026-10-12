#!/usr/bin/env python3
"""Assert the pinned backend can actually serve this adapter.

``BACKEND_NPM_VERSION`` is the backend a *published* install gets: nobody who
ran ``pip install`` has the monorepo's ``dist/server.js``, so the ``npx`` tier is
the only one that ever runs for them. A pin older than the routes and scopes the
adapter sends ships a feature dead, and dead quietly — a missing collector
settles as "DOM replay disabled" and an unanswered ``traceExport`` times out,
both leaving the run green.

`python.yml`'s drift check cannot catch it: that compares `_contract.py` against
`shared`, the monorepo's source, while this compares it against the npm tarball
a user downloads. The two agreed for every commit between the backend's last
release and this adapter's first.

Run:  python3 scripts/check_backend_pin.py
"""

from __future__ import annotations

import io
import json
import re
import sys
import tarfile
import urllib.error
import urllib.request
from pathlib import Path

SRC = Path(__file__).resolve().parent.parent / "src"
sys.path.insert(0, str(SRC))

from selenium_devtools import _contract as contract  # noqa: E402
from selenium_devtools.constants import (  # noqa: E402
    BACKEND_NPM_PACKAGE,
    BACKEND_NPM_VERSION,
    MIN_NODE,
)

REGISTRY = "https://registry.npmjs.org"
NETWORK_TIMEOUT_S = 60

# Named by contract constant, not by literal, so a rename in shared reaches this
# check through `_contract.py` rather than leaving a hand-copied string behind.
REQUIRED_BACKEND_NAMES = {
    "COLLECTOR_PATH": "serves the page collector — without it DOM replay is off",
    "ELEMENT_SCRIPTS_PATH": "serves the page-side element scripts",
    "SCOPE_TRACE_EXPORT": "builds the trace archive this adapter cannot build itself",
    "SCOPE_TRACE_EXPORTED": "answers the trace export request",
    "SCOPE_ACTION_SNAPSHOTS": "accumulates per-action DOM snapshots",
    "SCOPE_SCREENCAST_FRAMES": "accepts pushed screencast frames",
    "RERUN_SLOT_TEST_ID": "substitutes a pytest nodeid into a rerun command",
}

QUOTES = ('"', "'", "`")


def carries(dist: str, literal: str) -> bool:
    """Whether the bundle contains ``literal`` as a whole string.

    Quoted on both sides rather than searched bare, because `traceExport` is a
    prefix of `traceExported`: bare, a backend that dropped the request handler
    but kept the reply name passes. Any quote style counts so the check does not
    turn vacuous again if the bundler changes how it emits strings.
    """
    return any(f"{q}{literal}{q}" in dist for q in QUOTES)


def published_package(package: str, version: str) -> tuple[str, dict]:
    """Return one npm version's ``dist/*.js`` concatenated, and its ``package.json``."""
    meta_url = f"{REGISTRY}/{package}/{version}"
    with urllib.request.urlopen(meta_url, timeout=NETWORK_TIMEOUT_S) as response:
        tarball = json.load(response)["dist"]["tarball"]
    with urllib.request.urlopen(tarball, timeout=NETWORK_TIMEOUT_S) as response:
        payload = response.read()

    sources = []
    manifest: dict = {}
    with tarfile.open(fileobj=io.BytesIO(payload), mode="r:gz") as archive:
        for member in archive.getmembers():
            name = member.name.removeprefix("package/")
            if member.isfile() and name == "package.json":
                handle = archive.extractfile(member)
                if handle is not None:
                    manifest = json.load(handle)
                continue
            if not member.isfile() or not name.startswith("dist/"):
                continue
            if not name.endswith(".js"):
                continue
            handle = archive.extractfile(member)
            if handle is not None:
                sources.append(handle.read().decode("utf-8", "replace"))
    if not sources:
        raise RuntimeError(f"{package}@{version} published no dist/*.js")
    return "\n".join(sources), manifest


def missing_names(dist: str) -> list[tuple[str, str, str]]:
    """The ``(constant, literal, why)`` the given bundle does not carry."""
    return [
        (name, getattr(contract, name), why)
        for name, why in REQUIRED_BACKEND_NAMES.items()
        if not carries(dist, getattr(contract, name))
    ]


_NODE_RANGE_RE = re.compile(r"\s*>=\s*v?(\d+)(?:\.(\d+))?")


def parse_node_floor(engines_node: str | None) -> tuple[int, int] | None:
    """The leading ``>=X[.Y[.Z]]`` of an ``engines.node`` range, else None."""
    if not engines_node:
        return None
    match = _NODE_RANGE_RE.match(engines_node)
    if match is None:
        return None
    return (int(match.group(1)), int(match.group(2) or 0))


def node_floor_violation(
    engines_node: str | None, min_node: tuple[int, int]
) -> str | None:
    """Error text when the backend needs a newer Node than the adapter enforces.

    An absent range is not a violation; an unparseable one is, since the gate
    cannot prove the adapter's floor satisfies it.
    """
    if not engines_node:
        return None
    required = parse_node_floor(engines_node)
    if required is None:
        return (
            f"cannot read a minimum Node from the pinned backend's engines.node "
            f"{engines_node!r}; teach parse_node_floor its form"
        )
    if required <= min_node:
        return None
    return (
        f"the pinned backend requires Node {engines_node} but the adapter only "
        f"enforces Node {min_node[0]}.{min_node[1]}+ (MIN_NODE in constants.py)"
    )


def main() -> int:
    pin = f"{BACKEND_NPM_PACKAGE}@{BACKEND_NPM_VERSION}"
    try:
        dist, manifest = published_package(BACKEND_NPM_PACKAGE, BACKEND_NPM_VERSION)
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            print(f"FAIL: {pin} is not published on npm", file=sys.stderr)
            return 1
        raise

    engines_node = (manifest.get("engines") or {}).get("node")
    node_error = node_floor_violation(engines_node, MIN_NODE)
    if node_error:
        print(f"FAIL: {pin}: {node_error}", file=sys.stderr)

    missing = missing_names(dist)
    if not missing:
        if node_error:
            return 1
        print(f"{pin} serves all {len(REQUIRED_BACKEND_NAMES)} pinned contract names")
        return 0

    print(
        f"FAIL: {pin} does not serve this adapter's contract.\n"
        f"      A `pip install` user gets that backend, so each name below is a\n"
        f"      feature that would ship broken:\n",
        file=sys.stderr,
    )
    for name, literal, why in missing:
        print(f"      {name} ({literal!r}) — {why}", file=sys.stderr)
    print(
        "\n      Release the backend to npm first, then raise "
        "BACKEND_NPM_VERSION in constants.py.",
        file=sys.stderr,
    )
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
