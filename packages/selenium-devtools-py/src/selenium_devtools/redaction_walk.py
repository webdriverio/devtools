"""Walks a captured value and replaces what a redactor covers, copying only the containers on the path to a change.

Mirrors ``shared/redaction-walk.ts``; ``packages/shared/mirror-vectors.json``
(``secretRedaction``) holds the cases both languages run.
"""

from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional, Sequence

#: What a redacted value reads as: the page mask's placeholder, so its length never leaks.
REDACTED_SECRET = "••••"

#: A secret shorter than this, after trimming, is ignored.
MIN_SECRET_LENGTH = 4

#: Header names whose values are replaced when a redactor covers credentials; compared case-insensitively.
AUTH_HEADER_NAMES = ("authorization", "proxy-authorization", "cookie", "set-cookie")

#: Keys a captured header map is stored under.
HEADER_KEYS = ("headers", "requestHeaders", "responseHeaders")

_COOKIE_KEYS = ("domain", "path", "httpOnly", "secure", "sameSite", "expiry")


class Rules:
    """``text`` replaces secrets in any string, ``credentials`` covers header and cookie values by key."""

    def __init__(self, text: Callable[[str], str], credentials: bool, secrets: bool) -> None:
        self.text = text
        self.credentials = credentials
        self.secrets = secrets


def walk(value: Any, rules: Rules, key: Optional[str] = None) -> Any:
    """A copy of ``value`` with the rules applied; ``value`` itself when nothing changed."""
    if isinstance(value, str):
        return rules.text(value)
    if isinstance(value, dict):
        return _redact_record(value, rules, key)
    if isinstance(value, (list, tuple)):
        typed = _redact_keystrokes(value, rules) if rules.secrets else None
        if typed is not None:
            return typed
        out: Optional[List[Any]] = None
        for i, item in enumerate(value):
            redacted = walk(item, rules)
            if _changed(redacted, item) and out is None:
                out = list(value)
            if out is not None:
                out[i] = redacted
        return out if out is not None else value
    return value


def _changed(redacted: Any, item: Any) -> bool:
    # A string compares by value (a rewrite may return an equal copy); a container by identity, since an unchanged one is returned as is.
    return redacted != item if isinstance(item, str) else redacted is not item


def _redact_keystrokes(items: Sequence[Any], rules: Rules) -> Optional[List[str]]:
    # A W3C Send Keys payload spells the text one character per item; the array takes the placeholder's length.
    if len(items) < MIN_SECRET_LENGTH or not all(isinstance(i, str) and len(i) == 1 for i in items):
        return None
    typed = "".join(items)
    redacted = rules.text(typed)
    return None if redacted == typed else list(redacted)


def _redact_credential(value: Any) -> Any:
    if isinstance(value, str):
        return REDACTED_SECRET
    if isinstance(value, (list, tuple)):
        return [_redact_credential(v) for v in value]
    return value


def _redact_cookie_string(text: str) -> str:
    # A split, so the time is linear in the text.
    return ";".join(
        f"{pair[:pair.index('=')]}={REDACTED_SECRET}" if pair.find("=") > 0 else pair
        for pair in text.split(";")
    )


def _is_cookie_object(record: Dict[str, Any]) -> bool:
    return (
        isinstance(record.get("name"), str)
        and isinstance(record.get("value"), str)
        and any(k in record for k in _COOKIE_KEYS)
    )


def _redact_string_entry(record: Dict[str, Any], key: str, item: str, rules: Rules) -> str:
    if rules.credentials and key == "cookies":
        return rules.text(_redact_cookie_string(item))
    if rules.credentials and key == "value" and _is_cookie_object(record):
        return REDACTED_SECRET
    # Base64 bodies named by their key; rewriting a chance match would corrupt them.
    if key == "screenshot" or (key == "data" and "mimeType" in record):
        return item
    return rules.text(item)


def _redact_record(record: Dict[str, Any], rules: Rules, parent_key: Optional[str]) -> Dict[str, Any]:
    is_headers = rules.credentials and parent_key in HEADER_KEYS
    out: Optional[Dict[str, Any]] = None
    for key, item in record.items():
        if is_headers and isinstance(key, str) and key.lower() in AUTH_HEADER_NAMES:
            redacted = _redact_credential(item)
        elif isinstance(item, str):
            redacted = _redact_string_entry(record, key, item, rules)
        else:
            redacted = walk(item, rules, key)
        if _changed(redacted, item) and out is None:
            out = dict(record)
        if out is not None:
            out[key] = redacted
    return out if out is not None else record
