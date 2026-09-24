"""The fragment-to-release machinery.

It runs once per release and rewrites the version, the changelog and the
fragments in one pass, so a bug in it is discovered by a bad release. The pure
parts are exercised here against a temp package tree.
"""

from __future__ import annotations

import datetime as dt
import importlib.util
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent.parent / "scripts"


def _load_script():
    spec = importlib.util.spec_from_file_location("changes", SCRIPTS / "changes.py")
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


changes = _load_script()


def _fragment(bump: str, body: str) -> str:
    return f"---\n{bump}\n---\n\n{body}\n"


class ParseFragmentTest(unittest.TestCase):
    def test_a_well_formed_fragment_yields_bump_and_body(self) -> None:
        self.assertEqual(
            changes.parse_fragment(_fragment("minor", "Serve the collector.")),
            ("minor", "Serve the collector."),
        )

    def test_a_multi_line_body_is_kept_whole(self) -> None:
        body = "First line.\n\nSecond paragraph."
        self.assertEqual(changes.parse_fragment(_fragment("patch", body))[1], body)

    def test_an_unknown_bump_is_refused(self) -> None:
        with self.assertRaises(changes.ChangeError):
            changes.parse_fragment(_fragment("huge", "x"))

    def test_a_bodyless_fragment_is_refused(self) -> None:
        # A changelog line nobody wrote is worse than an absent one.
        with self.assertRaises(changes.ChangeError):
            changes.parse_fragment("---\npatch\n---\n")

    def test_prose_without_frontmatter_is_refused(self) -> None:
        with self.assertRaises(changes.ChangeError):
            changes.parse_fragment("just a note\n")


class BumpTest(unittest.TestCase):
    def test_the_strongest_level_pending_wins(self) -> None:
        self.assertEqual(changes.highest_bump(["patch", "major", "minor"]), "major")
        self.assertEqual(changes.highest_bump(["patch", "minor"]), "minor")
        self.assertEqual(changes.highest_bump(["patch"]), "patch")

    def test_each_level_moves_the_expected_part(self) -> None:
        self.assertEqual(changes.next_version("0.1.0", "patch"), "0.1.1")
        self.assertEqual(changes.next_version("0.1.0", "minor"), "0.2.0")
        self.assertEqual(changes.next_version("0.1.0", "major"), "1.0.0")

    def test_a_bump_resets_the_parts_below_it(self) -> None:
        self.assertEqual(changes.next_version("1.4.7", "minor"), "1.5.0")
        self.assertEqual(changes.next_version("1.4.7", "major"), "2.0.0")

    def test_a_malformed_version_is_refused(self) -> None:
        with self.assertRaises(changes.ChangeError):
            changes.next_version("0.1", "patch")


class ChangelogTest(unittest.TestCase):
    def test_a_new_section_lands_above_the_newest_existing_one(self) -> None:
        existing = "# Title\n\nPreamble.\n\n## 0.1.0 — 2026-01-01\n\n- First.\n"
        section = changes.render_section("0.2.0", ["Second."], dt.date(2026, 2, 2))
        merged = changes.insert_section(existing, section)
        self.assertLess(merged.index("## 0.2.0"), merged.index("## 0.1.0"))
        self.assertIn("Preamble.", merged)
        # The preamble must stay above both, not be pushed under the new entry.
        self.assertLess(merged.index("Preamble."), merged.index("## 0.2.0"))

    def test_a_changelog_with_no_sections_yet_still_gains_one(self) -> None:
        section = changes.render_section("0.1.0", ["First."], dt.date(2026, 2, 2))
        merged = changes.insert_section("# Title\n\nPreamble.\n", section)
        self.assertIn("## 0.1.0", merged)
        self.assertLess(merged.index("Preamble."), merged.index("## 0.1.0"))

    def test_every_body_reaches_the_section(self) -> None:
        section = changes.render_section(
            "0.2.0", ["One.", "Two."], dt.date(2026, 2, 2)
        )
        self.assertIn("- One.", section)
        self.assertIn("- Two.", section)

    def test_a_second_paragraph_stays_inside_its_bullet(self) -> None:
        # Unindented it closes the list, and the paragraph reads as belonging to
        # the release rather than to the entry.
        section = changes.render_section(
            "0.2.0", ["Headline.\n\nDetail."], dt.date(2026, 2, 2)
        )
        self.assertIn("- Headline.\n\n  Detail.", section)


class CheckTest(unittest.TestCase):
    """The PR gate, with the diff stubbed so no git history is needed."""

    def setUp(self) -> None:
        self._saved = changes.changed_files
        self._fragments = changes.load_fragments
        changes.load_fragments = lambda *a, **k: []

    def tearDown(self) -> None:
        changes.changed_files = self._saved
        changes.load_fragments = self._fragments

    def _files(self, *paths: str) -> None:
        changes.changed_files = lambda base: list(paths)

    def test_a_docs_only_change_needs_nothing(self) -> None:
        self._files("packages/selenium-devtools-py/README.md")
        self.assertEqual(changes.check("main"), 0)

    def test_a_src_change_with_no_record_is_refused(self) -> None:
        self._files("packages/selenium-devtools-py/src/selenium_devtools/bidi.py")
        self.assertEqual(changes.check("main"), 1)

    def test_a_fragment_satisfies_it(self) -> None:
        self._files("packages/selenium-devtools-py/src/selenium_devtools/bidi.py")
        changes.load_fragments = lambda *a, **k: [(Path("a.md"), "patch", "Fixed.")]
        self.assertEqual(changes.check("main"), 0)

    def test_a_changelog_edit_satisfies_it(self) -> None:
        # The bootstrap case: before the first release the pending entry is the
        # changelog section itself.
        self._files(
            "packages/selenium-devtools-py/src/selenium_devtools/bidi.py",
            "packages/selenium-devtools-py/CHANGELOG.md",
        )
        self.assertEqual(changes.check("main"), 0)

    def test_another_package_src_is_not_this_gate_s_business(self) -> None:
        self._files("packages/selenium-devtools/src/index.ts")
        self.assertEqual(changes.check("main"), 0)


class ApplyReleaseTest(unittest.TestCase):
    """The whole pass, against a throwaway copy of the package's layout."""

    def setUp(self) -> None:
        self._dir = tempfile.TemporaryDirectory()
        root = Path(self._dir.name)
        (root / "changes").mkdir()
        (root / "src" / "selenium_devtools").mkdir(parents=True)
        (root / "src" / "selenium_devtools" / "__init__.py").write_text(
            '"""doc."""\n\n__version__ = "0.1.0"\n\nX = 1\n'
        )
        (root / "CHANGELOG.md").write_text(
            "# selenium-devtools-py\n\nPreamble.\n\n## 0.1.0\n\nFirst release.\n"
        )
        self._patched = {
            "CHANGES_DIR": root / "changes",
            "CHANGELOG": root / "CHANGELOG.md",
            "VERSION_FILE": root / "src" / "selenium_devtools" / "__init__.py",
        }
        self._saved = {k: getattr(changes, k) for k in self._patched}
        for key, value in self._patched.items():
            setattr(changes, key, value)
        self.root = root

    def tearDown(self) -> None:
        for key, value in self._saved.items():
            setattr(changes, key, value)
        self._dir.cleanup()

    def _write(self, name: str, bump: str, body: str) -> None:
        (self.root / "changes" / name).write_text(_fragment(bump, body))

    def test_a_release_bumps_writes_and_consumes(self) -> None:
        self._write("a.md", "patch", "Fixed a thing.")
        self._write("b.md", "minor", "Added a thing.")

        version = changes.apply_release(today=dt.date(2026, 3, 4))

        self.assertEqual(version, "0.2.0")
        self.assertEqual(changes.read_version(self._patched["VERSION_FILE"]), "0.2.0")
        changelog = self._patched["CHANGELOG"].read_text()
        self.assertIn("## 0.2.0 — 2026-03-04", changelog)
        self.assertIn("- Added a thing.", changelog)
        self.assertIn("- Fixed a thing.", changelog)
        # The previous release survives, below the new one.
        self.assertLess(changelog.index("## 0.2.0"), changelog.index("## 0.1.0"))
        self.assertEqual(list(self._patched["CHANGES_DIR"].glob("*.md")), [])

    def test_the_rest_of_the_version_module_is_untouched(self) -> None:
        self._write("a.md", "patch", "Fixed.")
        changes.apply_release(today=dt.date(2026, 3, 4))
        text = self._patched["VERSION_FILE"].read_text()
        self.assertIn('"""doc."""', text)
        self.assertIn("X = 1", text)

    def test_no_fragments_leaves_everything_alone(self) -> None:
        # The first release publishes a hand-written version; the workflow's
        # index preflight is what refuses a version already published.
        before = self._patched["CHANGELOG"].read_text()
        self.assertEqual(changes.apply_release(today=dt.date(2026, 3, 4)), "0.1.0")
        self.assertEqual(self._patched["CHANGELOG"].read_text(), before)

    def test_the_directory_readme_is_not_a_fragment(self) -> None:
        (self.root / "changes" / "README.md").write_text("How to add a fragment.\n")
        self.assertEqual(changes.apply_release(today=dt.date(2026, 3, 4)), "0.1.0")

    def test_a_broken_fragment_names_itself_and_writes_nothing(self) -> None:
        self._write("good.md", "patch", "Fixed.")
        (self.root / "changes" / "bad.md").write_text("no frontmatter\n")
        with self.assertRaises(changes.ChangeError) as caught:
            changes.apply_release(today=dt.date(2026, 3, 4))
        self.assertIn("bad.md", str(caught.exception))
        self.assertEqual(changes.read_version(self._patched["VERSION_FILE"]), "0.1.0")
        self.assertTrue((self.root / "changes" / "good.md").exists())


if __name__ == "__main__":
    unittest.main()
