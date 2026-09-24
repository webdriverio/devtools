"""The release gate that compares the pinned backend against the contract.

Worth testing rather than trusting to CI: the gate's only observable behaviour
in a green run is silence, so a bug that made it pass unconditionally would look
exactly like a correct check and be discovered by a broken release.
"""

from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent.parent / "scripts"


def _load_script():
    """Import the script by path — `scripts/` is not a package on sys.path."""
    spec = importlib.util.spec_from_file_location(
        "check_backend_pin", SCRIPTS / "check_backend_pin.py"
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


gate = _load_script()


def _bundle(*literals: str, quote: str = '"') -> str:
    """A stand-in bundle carrying each literal the way a bundler emits it."""
    return " ".join(f"{quote}{literal}{quote}" for literal in literals)


def _all_literals() -> list[str]:
    return [getattr(gate.contract, name) for name in gate.REQUIRED_BACKEND_NAMES]


class MissingNamesTest(unittest.TestCase):
    def test_a_bundle_carrying_every_literal_is_clean(self) -> None:
        self.assertEqual(gate.missing_names(_bundle(*_all_literals())), [])

    def test_every_quote_style_counts(self) -> None:
        for quote in gate.QUOTES:
            with self.subTest(quote=quote):
                bundle = _bundle(*_all_literals(), quote=quote)
                self.assertEqual(gate.missing_names(bundle), [])

    def test_an_empty_bundle_reports_every_name(self) -> None:
        missing = gate.missing_names("")
        self.assertEqual(
            {name for name, _, _ in missing}, set(gate.REQUIRED_BACKEND_NAMES)
        )

    def test_a_prefix_of_another_literal_does_not_satisfy_it(self) -> None:
        # `traceExport` is a strict prefix of `traceExported`, so a bare
        # substring search reports the request handler present in a bundle that
        # only ever mentions the reply — the one shape this gate must not miss.
        absent = gate.contract.SCOPE_TRACE_EXPORT
        bundle = _bundle(*[lit for lit in _all_literals() if lit != absent])
        missing = gate.missing_names(bundle)
        self.assertEqual([name for name, _, _ in missing], ["SCOPE_TRACE_EXPORT"])
        self.assertEqual(missing[0][1], absent)

    def test_an_unquoted_mention_does_not_count(self) -> None:
        # A path echoed in a comment or a log line is not a route the backend
        # serves.
        self.assertIn(
            "COLLECTOR_PATH",
            [name for name, _, _ in gate.missing_names(gate.contract.COLLECTOR_PATH)],
        )

    def test_every_required_name_exists_on_the_contract(self) -> None:
        # A renamed constant must break here, not silently drop a check: an
        # absent attribute would otherwise raise only on the release run.
        for name in gate.REQUIRED_BACKEND_NAMES:
            self.assertTrue(
                hasattr(gate.contract, name), f"{name} is no longer a contract constant"
            )


if __name__ == "__main__":
    unittest.main()
