"""Checks frames against ``packages/shared/wire-schema.json``.

The generated TypedDicts document the contract but enforce nothing at runtime,
and nothing runs mypy over this package. This is what does: every test that
sends through ``RecordingTransport`` fails on a field shared does not declare,
a missing required one, or a null where shared expects the key to be absent.
"""

from __future__ import annotations

import inspect
import json
import unittest
from pathlib import Path
from typing import Any, List, Optional


def _schema_path() -> Path:
    for parent in Path(__file__).resolve().parents:
        candidate = parent / "packages" / "shared" / "wire-schema.json"
        if candidate.exists():
            return candidate
    raise RuntimeError("wire-schema.json not found; these tests run in the monorepo")


SCHEMA = json.loads(_schema_path().read_text())

_TYPES = {
    "string": lambda v: isinstance(v, str),
    "number": lambda v: isinstance(v, (int, float)) and not isinstance(v, bool),
    "boolean": lambda v: isinstance(v, bool),
    "null": lambda v: v is None,
    "array": lambda v: isinstance(v, list),
    "object": lambda v: isinstance(v, dict),
}


def violations(scope: str, data: Any) -> List[str]:
    schema = SCHEMA["scopes"].get(scope)
    if schema is None:
        return [f"scope {scope!r} has no payload type in shared"]
    out: List[str] = []
    _check(schema, data, scope, out)
    return out


def _check(schema: dict, value: Any, path: str, out: List[str]) -> None:
    if "$ref" in schema:
        _check(SCHEMA["$defs"][schema["$ref"].rsplit("/", 1)[-1]], value, path, out)
        return
    if "anyOf" in schema:
        if not any(not _errors(s, value, path) for s in schema["anyOf"]):
            out.append(f"{path}: {value!r:.80} matches none of {schema['anyOf']}")
        return
    if "const" in schema:
        if type(value) is not type(schema["const"]) or value != schema["const"]:
            out.append(f"{path}: expected {schema['const']!r}, got {value!r:.80}")
        return
    kind = schema.get("type")
    if kind is None:
        return
    if not _TYPES[kind](value):
        out.append(f"{path}: expected {kind}, got {type(value).__name__} {value!r:.80}")
        return
    if "enum" in schema and value not in schema["enum"]:
        out.append(f"{path}: {value!r} is not one of {schema['enum']}")
    if kind == "array":
        for i, item in enumerate(value):
            _check(schema["items"], item, f"{path}[{i}]", out)
    if kind == "object":
        _check_object(schema, value, path, out)


def _check_object(schema: dict, value: dict, path: str, out: List[str]) -> None:
    props = schema.get("properties", {})
    for key in schema.get("required", []):
        if key not in value:
            out.append(f"{path}: missing required {key!r}")
    extra = schema.get("additionalProperties")
    for key, item in value.items():
        if key in props:
            _check(props[key], item, f"{path}.{key}", out)
        elif extra is False:
            out.append(f"{path}: {key!r} is not a field shared declares")
        elif isinstance(extra, dict):
            _check(extra, item, f"{path}.{key}", out)


def _errors(schema: dict, value: Any, path: str) -> List[str]:
    out: List[str] = []
    _check(schema, value, path, out)
    return out


def _owning_test() -> Optional[unittest.TestCase]:
    frame = inspect.currentframe()
    while frame is not None:
        candidate = frame.f_locals.get("self")
        if isinstance(candidate, unittest.TestCase):
            return candidate
        frame = frame.f_back
    return None


class RecordingTransport:
    """Records every frame, after checking it against the wire schema.

    A violation is not raised from ``send_json``: the adapter's best-effort
    senders catch every exception, so it would be swallowed exactly where it
    matters. It is collected instead and fails the test that created the
    transport at cleanup, outside any of the adapter's ``except`` blocks.
    """

    def __init__(self, *, sends: bool = True, raises_after: Any = None) -> None:
        self.connected = True
        self.sent: list = []
        self.violations: List[str] = []
        self._sends = sends
        self._raises_after = raises_after
        test = _owning_test()
        if test is None:
            raise RuntimeError("RecordingTransport must be created inside a TestCase")
        test.addCleanup(self.assert_clean)

    def assert_clean(self) -> None:
        if self.violations:
            raise AssertionError(
                "frame breaks the wire contract:\n  " + "\n  ".join(self.violations)
            )

    def send_json(self, scope: str, data: Any) -> bool:
        if self._raises_after is not None and len(self.sent) >= self._raises_after:
            raise OSError("socket gone")
        self.violations += violations(scope, data)
        self.sent.append((scope, data))
        return self._sends

    def of_scope(self, scope: str) -> list:
        return [data for s, data in self.sent if s == scope]

    def close(self) -> None:
        self.connected = False
