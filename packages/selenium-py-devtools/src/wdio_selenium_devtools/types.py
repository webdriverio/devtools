"""Wire payload types — the Python mirror of ``packages/shared/src/types.ts``.

TypedDicts document the ``data`` payload shapes behind each ``{scope, data}``
frame the dashboard consumes. They're structural (plain dicts at runtime); the
value is a single typed definition per concept, checkable by mypy.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, TypedDict, Union

#: Anything that survives ``json.dumps``. Payloads must reduce to this.
JSONValue = Union[
    None, bool, int, float, str, List["JSONValue"], Dict[str, "JSONValue"]
]

#: A ``{scope, data}`` frame's scope — a value from the generated ``_contract``.
Scope = str


class SerializedError(TypedDict):
    name: str
    message: str


class CommandLog(TypedDict, total=False):
    command: str
    args: List[Any]
    result: Any
    error: SerializedError
    timestamp: int
    startTime: int
    callSource: Optional[str]
    id: int


class ConsoleLog(TypedDict):
    type: str
    args: List[Any]
    timestamp: int
    source: str


class NetworkRequest(TypedDict, total=False):
    id: str
    url: str
    method: str
    status: Optional[int]
    timestamp: int
    startTime: int
    endTime: Optional[int]
    type: str


class Metadata(TypedDict, total=False):
    type: str
    sessionId: str
    url: Optional[str]
    capabilities: Dict[str, Any]
    desiredCapabilities: Dict[str, Any]
    testEnv: str


class TestStats(TypedDict, total=False):
    uid: str
    cid: str
    title: str
    fullTitle: str
    parent: str
    state: str
    start: str
    end: str
    type: str
    file: str
    retries: int
    _duration: int
    callSource: Optional[str]


class SuiteStats(TypedDict, total=False):
    uid: str
    cid: str
    title: str
    fullTitle: str
    type: str
    file: str
    start: str
    end: Optional[str]
    state: Optional[str]
    tests: List[TestStats]
    suites: List["SuiteStats"]
    hooks: List[Any]
    _duration: int
