"""Where the adapter writes run output. Mirrors ``core/output-dir.ts`` so all four
adapters group artifacts under the same ``test-results/`` subfolder, wherever the
base directory resolves to.

Base directory, by priority:

    1. ``user_configured_dir`` — explicit opt-in, honored as-is.
    2. ``dirname(test_file_path)`` — the folder holding the test that just ran.
    3. ``fallback_dir`` (default: cwd).

A candidate inside an installed-package directory is skipped: a test file
resolved through site-packages must not receive artifacts. That is the Python
counterpart of core skipping ``node_modules``. Each candidate must also be
writable, or resolution falls through to the next.
"""

from __future__ import annotations

import os
from typing import List, Optional

#: All run output is grouped under this subfolder, matching the JS adapters.
OUTPUT_SUBDIR = "test-results"

#: Installed-package segments: the analogue of core's ``node_modules`` filter.
_INSTALLED_SEGMENTS = (
    f"{os.sep}site-packages{os.sep}",
    f"{os.sep}dist-packages{os.sep}",
)


def _is_writable(directory: str) -> bool:
    return os.path.isdir(directory) and os.access(directory, os.W_OK)


def _resolve_base_dir(
    user_configured_dir: Optional[str],
    test_file_path: Optional[str],
    fallback_dir: Optional[str],
) -> str:
    fallback = fallback_dir or os.getcwd()
    # An explicit directory bypasses the installed-package and writability
    # filters: the user opted into it, and a surprising override is worse than
    # failing where they pointed us.
    if user_configured_dir:
        return user_configured_dir
    candidates: List[str] = []
    if test_file_path:
        candidates.append(os.path.dirname(os.path.abspath(test_file_path)))
    candidates.append(fallback)
    for directory in candidates:
        if not directory:
            continue
        if any(seg in f"{directory}{os.sep}" for seg in _INSTALLED_SEGMENTS):
            continue
        if _is_writable(directory):
            return directory
    return fallback


def resolve_adapter_output_dir(
    *,
    user_configured_dir: Optional[str] = None,
    test_file_path: Optional[str] = None,
    fallback_dir: Optional[str] = None,
) -> str:
    """Absolute path of the ``test-results`` directory to write into. Does not
    create it; ``ensure_output_dir`` does that at write time."""
    base = _resolve_base_dir(user_configured_dir, test_file_path, fallback_dir)
    return os.path.join(os.path.abspath(base), OUTPUT_SUBDIR)


def ensure_output_dir(directory: str) -> Optional[str]:
    """Create ``directory`` if needed. Returns it, or None when it cannot be
    created, so a caller can fall back rather than crash a user's test run."""
    try:
        os.makedirs(directory, exist_ok=True)
    except OSError:
        return None
    return directory if _is_writable(directory) else None
