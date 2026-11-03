"""The run's page mask policy, declared ahead of the collector source so the
page masks password fields, and anything the run names, in the replayed DOM.

Mirrors ``shared/input-mask.ts`` ``resolveCaptureMask`` and
``captureMaskPrelude``; ``packages/shared/mirror-vectors.json`` holds the cases
both languages run.
"""

from __future__ import annotations

import json
import os
from typing import Any, Dict, List, Optional, Sequence

from .constants import ENV_MASK_INPUTS, ENV_MASK_SELECTORS

#: The name the collector bundle reads its policy from.
CAPTURE_MASK_GLOBAL = "__wdioCaptureMask"

_FALSY = ("0", "false", "no", "off")

_state: Dict[str, Any] = {"inputs": True, "selectors": []}


def _env_inputs() -> bool:
    # An exported but empty variable is unset, so it keeps the default rather than turning masking off.
    raw = (os.environ.get(ENV_MASK_INPUTS) or "").strip().lower()
    return raw not in _FALSY


def _env_selectors() -> List[str]:
    return (os.environ.get(ENV_MASK_SELECTORS) or "").split(",")


def configure(
    mask_inputs: Optional[bool] = None,
    mask_selectors: Optional[Sequence[str]] = None,
) -> Dict[str, Any]:
    """Set the run's policy, an argument left None read from the environment."""
    raw = _env_selectors() if mask_selectors is None else list(mask_selectors)
    _state["inputs"] = _env_inputs() if mask_inputs is None else mask_inputs is not False
    _state["selectors"] = [s.strip() for s in raw if isinstance(s, str) and s.strip()]
    return dict(_state)


def capture_mask_prelude() -> str:
    """The declaration put ahead of the collector source, byte for byte what shared's ``captureMaskPrelude`` writes."""
    body = json.dumps(
        {"inputs": _state["inputs"], "selectors": _state["selectors"]},
        separators=(",", ":"),
        ensure_ascii=False,
    )
    return f"var {CAPTURE_MASK_GLOBAL} = {body};\n"
