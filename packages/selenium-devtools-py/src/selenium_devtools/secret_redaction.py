"""Value-based redaction of the run's ``secrets`` from every frame the adapter sends.

The backend builds this adapter's trace archive from those frames, so redacting
them covers the live dashboard and the archive alike.

Mirrors ``shared/secret-redaction.ts`` ``resolveSecrets`` and
``createSecretRedactor`` (the walk is ``redaction_walk.py``) and
``shared/typed-secrets.ts``; ``packages/shared/mirror-vectors.json`` holds the
cases both languages run.
"""

from __future__ import annotations

import json
import logging
import os
import re
import threading
from typing import Any, Callable, Dict, List, Mapping, Optional, Pattern, Sequence, Tuple, Union
from urllib.parse import quote

from .constants import ENV_SECRET_ENVS, LOGGER_NAME
from .redaction_walk import MIN_SECRET_LENGTH, REDACTED_SECRET, Rules, walk

#: One ``secrets`` entry: the value itself, or ``{"env": NAME}`` naming the variable holding it.
SecretEntry = Union[str, Mapping[str, str]]

#: Ceiling on the one field-type read a key-sending command waits for, as the JavaScript adapters cap theirs.
FIELD_TYPE_PROBE_TIMEOUT_S = 2.0

_SHORT_SECRET = (
    f"shorter than {MIN_SECRET_LENGTH} characters, so it is not redacted "
    "(that would rewrite unrelated text)"
)
_URI_SAFE = "-_.!~*'()"
_FORM_SAFE = frozenset(b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789*-._")
_DATA_URI_BASE64 = re.compile(r"data:[^,]{0,200};base64,")
_BASE64_BODY = re.compile(r"[A-Za-z0-9+/]+={0,2}")
_BINARY_MIN_LENGTH = 256

_log = logging.getLogger(f"{LOGGER_NAME}.secrets")


def resolve_secrets(
    entries: Optional[Sequence[Any]], env: Mapping[str, str]
) -> Tuple[List[str], List[str]]:
    """The run's secrets and the warnings to print, an ``{"env": NAME}`` entry read from ``env``."""
    secrets: List[str] = []
    warnings: List[str] = []
    for entry in entries or []:
        if isinstance(entry, str):
            value, label = entry, "a secret"
        elif isinstance(entry, Mapping) and isinstance(entry.get("env"), str) and entry["env"]:
            name = entry["env"]
            if name not in env:
                warnings.append(f"secrets: {name} is not set, so nothing is redacted for it")
                continue
            value, label = env[name], f"the secret in {name}"
        else:
            warnings.append("secrets: ignoring an entry that is neither a string nor { env: string }")
            continue
        if len(value.strip()) < MIN_SECRET_LENGTH:
            warnings.append(f"secrets: {label} is {_SHORT_SECRET}")
            continue
        if value not in secrets:
            secrets.append(value)
    return secrets, warnings


def _longest_first(forms: Sequence[str]) -> List[str]:
    # Lengths in UTF-16 code units, as the TypeScript side measures them.
    return sorted(set(forms), key=lambda s: (-len(s.encode("utf-16-le")) // 2, s))


def _uri_component(text: str) -> str:
    try:
        return quote(text, safe=_URI_SAFE)
    except UnicodeEncodeError:
        # A lone surrogate has no UTF-8 form, so no request can carry it encoded.
        return ""


def _form_encode(text: str) -> str:
    out = []
    for byte in text.encode("utf-8", errors="replace"):
        if byte == 0x20:
            out.append("+")
        elif byte in _FORM_SAFE:
            out.append(chr(byte))
        else:
            out.append(f"%{byte:02X}")
    return "".join(out)


def secret_variants(secret: str) -> List[str]:
    """Every form a secret takes in captured text: as typed, inside a JSON string, in a URL and in a form body."""
    forms = [
        secret,
        json.dumps(secret, ensure_ascii=False)[1:-1],
        _uri_component(secret),
        _form_encode(secret),
    ]
    return _longest_first([f for f in forms if f])


def _is_binary_like(text: str) -> bool:
    # A short secret occurs in base64 by chance, and rewriting one would corrupt the image.
    return bool(_DATA_URI_BASE64.match(text)) or (
        len(text) >= _BINARY_MIN_LENGTH and _BASE64_BODY.fullmatch(text) is not None
    )


_SPECIAL_KEY_CLASS = "[\ue000-\uf8ff]"
_SPECIAL_KEY = re.compile(_SPECIAL_KEY_CLASS)


def _with_keys_between(secret: str) -> str:
    """A typing row keeps the special keys pressed between its parts, so a secret typed with one inside still reads as the secret."""
    return (_SPECIAL_KEY_CLASS + "*").join(re.escape(char) for char in secret)


def typed_text(parts: Any) -> str:
    """The text a key-sending command typed: its string and number parts joined, special keys removed."""
    items = parts if isinstance(parts, (list, tuple)) else [parts]
    text = "".join(
        _number_text(p) if isinstance(p, (int, float)) and not isinstance(p, bool) else p
        for p in items
        if isinstance(p, str) or (isinstance(p, (int, float)) and not isinstance(p, bool))
    )
    return _SPECIAL_KEY.sub("", text)


def _number_text(value: Any) -> str:
    # JavaScript's String(): 2.0 reads "2", as the TypeScript side writes it.
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def is_redactable_value(text: str) -> bool:
    """Whether a value is long enough to redact, by the same rule ``secrets`` entries follow."""
    return len(text.strip()) >= MIN_SECRET_LENGTH


def is_password_field_type(field_type: Any) -> bool:
    """Whether an element's ``type`` reading names a password field."""
    return isinstance(field_type, str) and field_type.strip().lower() == "password"


class SecretRedactor:
    """Redacts the given secrets, typed passwords and optionally credentials from strings and JSON-shaped values."""

    def __init__(
        self, secrets: Sequence[str], auth_headers: bool = False, typed: Sequence[str] = ()
    ) -> None:
        self.typed = list(typed)
        self.secrets = list(dict.fromkeys([*secrets, *self.typed]))
        self.auth_headers = auth_headers
        self._variants = _longest_first([v for s in self.secrets for v in secret_variants(s)])
        typed_forms = set(self.secrets)
        self._pattern: Optional[Pattern[str]] = (
            re.compile(
                "|".join(
                    _with_keys_between(v) if v in typed_forms else re.escape(v)
                    for v in self._variants
                )
            )
            if self._variants
            else None
        )
        self._rules = Rules(self.redact_string, auth_headers, bool(self.secrets))

    def redact_string(self, text: str) -> str:
        if self._pattern is None:
            return text
        if _is_binary_like(text):
            return REDACTED_SECRET if text in self._variants else text
        return self._pattern.sub(REDACTED_SECRET, text)

    def redact(self, value: Any) -> Any:
        """A copy of the value with the rules applied; the value itself when nothing changed. Keys are kept."""
        return walk(value, self._rules)


def create_secret_redactor(
    secrets: Sequence[str], auth_headers: bool = False, typed: Sequence[str] = ()
) -> Optional[SecretRedactor]:
    """A redactor, or None when it would change nothing, so a send pays nothing."""
    if not secrets and not typed and not auth_headers:
        return None
    return SecretRedactor(secrets, auth_headers, typed)


_state: Dict[str, Any] = {
    "configured": [],
    "typed": [],
    "automatic": True,
    "redactor": None,
    "stalled": set(),
}


def _rebuild() -> None:
    _state["redactor"] = create_secret_redactor(
        _state["configured"], auth_headers=_state["automatic"], typed=_state["typed"]
    )


_rebuild()


def _env_entries() -> List[Dict[str, str]]:
    raw = os.environ.get(ENV_SECRET_ENVS) or ""
    return [{"env": name.strip()} for name in raw.split(",") if name.strip()]


def configure(secrets: Optional[Sequence[SecretEntry]] = None, automatic: bool = True) -> List[str]:
    """Set the run's secrets, reading each ``{"env": NAME}`` now; None reads ``DEVTOOLS_SECRET_ENVS``.

    ``automatic`` (the ``mask_inputs`` switch) also redacts what is typed into
    password fields and credential headers and cookies; passwords already
    learned stay redacted unless it is off. Returns the warnings; only their count is logged.
    """
    entries = _env_entries() if secrets is None else list(secrets)
    resolved, warnings = resolve_secrets(entries, os.environ)
    _state.update(configured=resolved, automatic=automatic)
    if not automatic:
        _state["typed"] = []
    _rebuild()
    if warnings:
        # A count only: a log line never carries anything read from the entries or the environment.
        _log.warning("secrets: %d entries skipped (too short, an unset variable, or not a string or {env})", len(warnings))
    return warnings


_TIMED_OUT = object()


def _read_with_ceiling(read_field_type: Callable[[], Any]) -> Any:
    # A driver call cannot be interrupted, so the read runs on its own thread and an overrun is abandoned.
    result: Dict[str, Any] = {}

    def run() -> None:
        try:
            result["type"] = read_field_type()
        except Exception as exc:  # noqa: BLE001 - a failed read leaves the value as typed, never the command
            _log.debug("field type read failed (%s); the typed value is not redacted", type(exc).__name__)

    reader = threading.Thread(target=run, name="devtools-field-type", daemon=True)
    reader.start()
    reader.join(FIELD_TYPE_PROBE_TIMEOUT_S)
    return _TIMED_OUT if reader.is_alive() else result.get("type")


def note_typed_input(parts: Any, read_field_type: Callable[[], Any], session: Any = None) -> bool:
    """Add what a key-sending command typed to the run's secrets when ``read_field_type`` names a password field; True when it was new."""
    text = typed_text(parts)
    known = text in _state["typed"] or text in _state["configured"]
    if not _state["automatic"] or known or not is_redactable_value(text) or session in _state["stalled"]:
        return False
    field_type = _read_with_ceiling(read_field_type)
    if field_type is _TIMED_OUT:
        # The abandoned read is still on the session, so no later read may queue beside the user's commands on it.
        _state["stalled"].add(session)
        return False
    if is_password_field_type(field_type) and text not in _state["typed"]:
        _state["typed"].append(text)
        _rebuild()
        return True
    return False


def redact(value: Any) -> Any:
    """The value with the run's secrets redacted, or the value itself when nothing is redacted."""
    redactor = _state["redactor"]
    return value if redactor is None else redactor.redact(value)
