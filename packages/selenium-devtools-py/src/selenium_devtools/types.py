"""Wire payload types.

Every payload shape is generated into ``_wire_types`` from
``packages/shared/wire-schema.json`` and re-exported here. The two aliases below
are Python-only and have no counterpart in shared.
"""

from __future__ import annotations

from typing import Dict, List, Union

from ._wire_types import *  # noqa: F401,F403
from ._wire_types import __all__ as _wire_names

#: Anything that survives ``json.dumps``. Payloads must reduce to this.
JSONValue = Union[
    None, bool, int, float, str, List["JSONValue"], Dict[str, "JSONValue"]
]

#: A ``{scope, data}`` frame's scope — a value from the generated ``_contract``.
Scope = str

__all__ = [*_wire_names, "JSONValue", "Scope"]
