"""Masks typed text before it leaves the process: input command payloads where
they are captured, then every other place a typed value can resurface (a value
read, an assertion operand, a log line, a request body) by scrubbing the values
those commands carried.

Mirrors ``core/input-masking.ts`` and ``shared/input-mask.ts`` for the W3C wire
vocabulary this adapter reports; ``packages/shared/mirror-vectors.json`` holds
the cases both languages run.
"""

from __future__ import annotations

import json
import os
import re
from collections import OrderedDict
from typing import Any, Dict, List, Optional, Sequence
from urllib.parse import quote

from .constants import ENV_MASK_INPUTS, ENV_MASK_SELECTORS

#: What every masked value reads as. Fixed, so a value's length never leaks.
MASKED_VALUE = "••••"
#: The name the collector bundle reads its policy from.
CAPTURE_MASK_GLOBAL = "__wdioCaptureMask"
#: Shorter typed values are not scrubbed out of free text, where they would rewrite unrelated words.
SCRUB_MIN_LENGTH = 4

_TYPED_VALUES_MAX = 200
#: A single character carries nothing to scrub elsewhere, and remembering one would mask every equal string.
_TYPED_VALUE_MIN = 2
_SCRUB_DEPTH_MAX = 8
_FALSY = ("0", "false", "no", "off", "")
_SPECIAL_KEY = re.compile("[\ue000-\uf8ff]")
_SPECIAL_KEY_ONLY = re.compile("^[\ue000-\uf8ff]+$")
_TYPED_RUN = re.compile("[^\ue000-\uf8ff]+")
_URI_SAFE = "-_.!~*'()"

_state: Dict[str, Any] = {"inputs": True, "selectors": []}
_typed: "OrderedDict[str, None]" = OrderedDict()
_pattern: Dict[str, Any] = {"compiled": None, "built_for": -1}
#: Bumped on every change to the remembered set; the pattern records the version it was built from.
_version = {"value": 0}


def _env_inputs() -> bool:
    raw = os.environ.get(ENV_MASK_INPUTS)
    return True if raw is None else raw.strip().lower() not in _FALSY


def _env_selectors() -> List[str]:
    return (os.environ.get(ENV_MASK_SELECTORS) or "").split(",")


def configure(
    mask_inputs: Optional[bool] = None,
    mask_selectors: Optional[Sequence[str]] = None,
) -> Dict[str, Any]:
    """Set the run's policy, an argument left None read from the environment; what was typed is forgotten only on a change."""
    inputs = _env_inputs() if mask_inputs is None else mask_inputs is not False
    raw = _env_selectors() if mask_selectors is None else list(mask_selectors)
    selectors = [s.strip() for s in raw if isinstance(s, str) and s.strip()]
    if _state["inputs"] != inputs or _state["selectors"] != selectors:
        _state["inputs"] = inputs
        _state["selectors"] = selectors
        clear_typed()
    return dict(_state)


def clear_typed() -> None:
    """Forget what was typed, at a test's start, so one test's values do not mask the next one's output."""
    _typed.clear()
    _version["value"] += 1


def capture_mask_prelude() -> str:
    """The declaration put ahead of the collector source, byte for byte what shared's ``captureMaskPrelude`` writes."""
    body = json.dumps(
        {"inputs": _state["inputs"], "selectors": _state["selectors"]},
        separators=(",", ":"),
        ensure_ascii=False,
    )
    return f"var {CAPTURE_MASK_GLOBAL} = {body};\n"


def _remember(text: str) -> None:
    typed = _SPECIAL_KEY.sub("", text)
    if len(typed) < _TYPED_VALUE_MIN:
        return
    _typed.pop(typed, None)
    _typed[typed] = None
    if len(_typed) > _TYPED_VALUES_MAX:
        _typed.popitem(last=False)
    _version["value"] += 1


def _mask_string(value: str) -> str:
    if value == "":
        return value
    _remember(value)
    return _TYPED_RUN.sub(MASKED_VALUE, value)


def _is_typed_key(action: Any) -> bool:
    return (
        isinstance(action, dict)
        and action.get("type") in ("keyDown", "keyUp")
        and isinstance(action.get("value"), str)
        and action["value"] != ""
        and not _SPECIAL_KEY_ONLY.match(action["value"])
    )


#: Shift (left, right) only changes what the keys type, so it belongs to the run it is held through.
_SHIFT_KEYS = frozenset(["\ue008", "\ue050"])


def _is_shift(action: Any) -> bool:
    return (
        isinstance(action, dict)
        and action.get("type") in ("keyDown", "keyUp")
        and action.get("value") in _SHIFT_KEYS
    )


def _mask_key_actions(actions: List[Any]) -> List[Any]:
    """Each run of typed keys collapses to one masked press, so the count does not survive; mirrors core's maskKeyActions."""
    out: List[Any] = []
    run: List[str] = []
    members: List[Any] = []
    held: List[Any] = []
    flags = {"shifted": False, "typed": False}

    def flush() -> None:
        nonlocal run, members, held
        if flags["typed"]:
            _remember("".join(run))
            out.extend([{"type": "keyDown", "value": MASKED_VALUE}, {"type": "keyUp", "value": MASKED_VALUE}])
        else:
            out.extend(members)
        out.extend(held)
        run, members, held = [], [], []
        flags["typed"] = False

    for action in actions:
        if _is_shift(action) or _is_typed_key(action):
            if _is_typed_key(action):
                flags["typed"] = True
                if action["type"] == "keyDown":
                    run.append(action["value"].upper() if flags["shifted"] else action["value"])
            else:
                flags["shifted"] = action["type"] == "keyDown"
            members.extend(held)
            members.append(action)
            held = []
        elif members and isinstance(action, dict) and action.get("type") == "pause":
            held.append(action)
        else:
            flush()
            out.append(action)
    flush()
    return out


def _mask_actions(sources: Any) -> Any:
    if not isinstance(sources, list):
        return sources
    return [
        {**source, "actions": _mask_key_actions(source["actions"])}
        if isinstance(source, dict) and source.get("type") == "key" and isinstance(source.get("actions"), list)
        else source
        for source in sources
    ]


def _mask_send_keys(params: Dict[str, Any]) -> Dict[str, Any]:
    masked = dict(params)
    if isinstance(params.get("text"), str):
        masked["text"] = _mask_string(params["text"])
    # The wire splits the text into one entry per character, so masking each would still count them.
    if isinstance(params.get("value"), list):
        masked["value"] = [_mask_string("".join(str(v) for v in params["value"]))]
    return masked


def mask_command_params(command: str, params: Any) -> Any:
    """``params`` as the row may carry them; the caller's dict is never changed, since the driver still needs the real text."""
    if not _state["inputs"] or not isinstance(params, dict):
        return params
    if command in ("sendKeysToElement", "setAlertValue"):
        return _mask_send_keys(params)
    if command == "w3cActions":
        return {**params, "actions": _mask_actions(params.get("actions"))}
    return params


def _forms(value: str) -> List[str]:
    if len(value) < SCRUB_MIN_LENGTH:
        return []
    uri = quote(value, safe=_URI_SAFE)
    forms = [value, uri, uri.replace("%20", "+"), json.dumps(value, ensure_ascii=False)[1:-1]]
    return list(dict.fromkeys(forms))


def _compiled() -> Optional["re.Pattern[str]"]:
    """One pattern for every form of every value, longest first, rebuilt only when the remembered set changed."""
    # Version first, then the copy: a value remembered after either reads as a change and rebuilds the next time.
    version = _version["value"]
    if _pattern["built_for"] != version:
        forms: List[str] = []
        # A copy: send_keys on the test thread can add a value while a BiDi thread scrubs.
        for value in list(_typed):
            forms.extend(_forms(value))
        ordered = sorted(dict.fromkeys(forms), key=len, reverse=True)
        _pattern["compiled"] = re.compile("|".join(map(re.escape, ordered))) if ordered else None
        _pattern["built_for"] = version
    return _pattern["compiled"]


def scrub_text(text: str) -> str:
    """Equal to a typed value: masked whatever its length. Containing one: only past ``SCRUB_MIN_LENGTH``."""
    if not _typed or not text:
        return text
    if text in _typed:
        return MASKED_VALUE
    if len(text) < SCRUB_MIN_LENGTH:
        return text
    compiled = _compiled()
    return compiled.sub(MASKED_VALUE, text) if compiled else text


def _scrub_deep(value: Any, depth: int) -> Any:
    if isinstance(value, str):
        return scrub_text(value)
    if depth > _SCRUB_DEPTH_MAX:
        return value
    if isinstance(value, list):
        return [_scrub_deep(v, depth + 1) for v in value]
    if isinstance(value, dict):
        return {k: _scrub_deep(v, depth + 1) for k, v in value.items()}
    return value


def scrub(value: Any) -> Any:
    """``value`` with every string inside it scrubbed; a copy, never the original."""
    return value if not _typed else _scrub_deep(value, 0)


def scrub_row(entry: Dict[str, Any]) -> None:
    """Scrub a command row's text-bearing fields in place, leaving its screenshot alone."""
    if not _typed:
        return
    for key in ("args", "result", "error", "title"):
        if key in entry:
            entry[key] = scrub(entry[key])


def scrub_request(request: Dict[str, Any]) -> None:
    """A request body can carry what was typed (a login POST); the url and headers are kept."""
    if not _typed:
        return
    for key in ("requestBody", "responseBody"):
        if isinstance(request.get(key), str):
            request[key] = scrub_text(request[key])
