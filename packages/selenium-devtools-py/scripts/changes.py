#!/usr/bin/env python3
"""Pending-change fragments for this package — the changesets stand-in.

Changesets cannot serve this package: it discovers packages through the pnpm
workspace and identifies them by `package.json`, and this one is in neither. A
changeset naming it does not degrade, it raises "not in the workspace" and fails
`changeset version`, taking the whole npm release with it.

So the same shape lives here: one fragment per change declaring a bump level,
assembled at release into a version and a changelog section.

Run:  python3 scripts/changes.py {check,next-version,apply} [--base REF]
"""

from __future__ import annotations

import argparse
import datetime as dt
import re
import subprocess
import sys
from pathlib import Path

PACKAGE_ROOT = Path(__file__).resolve().parent.parent
CHANGES_DIR = PACKAGE_ROOT / "changes"
CHANGELOG = PACKAGE_ROOT / "CHANGELOG.md"
VERSION_FILE = PACKAGE_ROOT / "src" / "selenium_devtools" / "__init__.py"

# Ordered weakest to strongest: a release takes the strongest level pending.
BUMPS = ("patch", "minor", "major")

VERSION_RE = re.compile(r'^__version__ = "(?P<version>[^"]+)"$', re.MULTILINE)
FRAGMENT_RE = re.compile(r"\A---\s*\n(?P<bump>\w+)\s*\n---\s*\n(?P<body>.*)\Z", re.S)

# Where a release inserts its section: after the header prose, before the
# newest existing entry.
FIRST_RELEASE_HEADING_RE = re.compile(r"^## ", re.MULTILINE)


class ChangeError(Exception):
    """A fragment or version that cannot be read as intended."""


def parse_fragment(text: str) -> tuple[str, str]:
    """Return ``(bump, body)`` for one fragment's source."""
    match = FRAGMENT_RE.match(text.strip() + "\n")
    if not match:
        raise ChangeError(
            "expected a fragment opening with `---`, a bump level, and `---`"
        )
    bump = match.group("bump").lower()
    if bump not in BUMPS:
        raise ChangeError(f"unknown bump level {bump!r}; expected one of {BUMPS}")
    body = match.group("body").strip()
    if not body:
        raise ChangeError("fragment has no body — say what changed, for a user")
    return bump, body


def load_fragments(directory: Path | None = None) -> list[tuple[Path, str, str]]:
    """Every pending fragment as ``(path, bump, body)``, in filename order.

    The paths resolve at call time, not as default arguments: bound at import a
    default freezes a copy, so the module constants above would stop being the
    thing that decides where this reads.
    """
    found = []
    for path in sorted((directory or CHANGES_DIR).glob("*.md")):
        if path.name == "README.md":
            continue
        try:
            found.append((path, *parse_fragment(path.read_text())))
        except ChangeError as exc:
            raise ChangeError(f"{path.name}: {exc}") from exc
    return found


def highest_bump(bumps: list[str]) -> str:
    return max(bumps, key=BUMPS.index)


def next_version(current: str, bump: str) -> str:
    try:
        major, minor, patch = (int(part) for part in current.split("."))
    except ValueError as exc:
        raise ChangeError(f"{current!r} is not a three-part version") from exc
    if bump == "major":
        return f"{major + 1}.0.0"
    if bump == "minor":
        return f"{major}.{minor + 1}.0"
    return f"{major}.{minor}.{patch + 1}"


def read_version(path: Path | None = None) -> str:
    path = path or VERSION_FILE
    match = VERSION_RE.search(path.read_text())
    if not match:
        raise ChangeError(f"no __version__ assignment in {path}")
    return match.group("version")


def write_version(version: str, path: Path | None = None) -> None:
    path = path or VERSION_FILE
    text = path.read_text()
    updated, count = VERSION_RE.subn(f'__version__ = "{version}"', text, count=1)
    if count != 1:
        raise ChangeError(f"no __version__ assignment in {path}")
    path.write_text(updated)


def as_bullet(body: str) -> str:
    """One fragment body as a list item.

    Continuation lines are indented under the bullet, or a second paragraph
    closes the list and reads as prose belonging to the release rather than to
    the entry. Blank lines are left empty rather than indented, which would
    otherwise leave trailing whitespace on every one of them.
    """
    first, *rest = body.split("\n")
    lines = [f"- {first}"]
    lines += [f"  {line}" if line.strip() else "" for line in rest]
    return "\n".join(lines)


def render_section(version: str, bodies: list[str], today: dt.date) -> str:
    entries = "\n\n".join(as_bullet(body) for body in bodies)
    return f"## {version} — {today.isoformat()}\n\n{entries}\n"


def insert_section(changelog: str, section: str) -> str:
    """Put the new section above the newest existing one."""
    match = FIRST_RELEASE_HEADING_RE.search(changelog)
    if not match:
        return changelog.rstrip() + "\n\n" + section
    head, tail = changelog[: match.start()], changelog[match.start() :]
    return f"{head}{section}\n{tail}"


def apply_release(today: dt.date | None = None) -> str:
    """Consume the pending fragments. Returns the version to publish."""
    fragments = load_fragments()
    current = read_version()
    if not fragments:
        # Not an error: the first release publishes a version written by hand,
        # and the workflow's index preflight is what refuses a version already
        # published with nothing new to say.
        return current

    version = next_version(current, highest_bump([bump for _, bump, _ in fragments]))
    write_version(version)
    section = render_section(
        version, [body for _, _, body in fragments], today or dt.date.today()
    )
    CHANGELOG.write_text(insert_section(CHANGELOG.read_text(), section))
    for path, _, _ in fragments:
        path.unlink()
    return version


def changed_files(base: str) -> list[str]:
    result = subprocess.run(
        ["git", "diff", "--name-only", f"{base}...HEAD"],
        capture_output=True,
        text=True,
        check=True,
        cwd=PACKAGE_ROOT,
    )
    return [line for line in result.stdout.splitlines() if line]


def check(base: str) -> int:
    """Refuse a source change that documents nothing."""
    files = changed_files(base)
    package = "packages/selenium-devtools-py/"
    touched_src = [f for f in files if f.startswith(f"{package}src/")]
    if not touched_src:
        print("no change to src/ — no fragment needed")
        return 0
    if load_fragments():
        print("src/ changed and a change fragment is present")
        return 0
    # An edit to the changelog itself also counts. Before the first release
    # there is nothing to bump from, so the pending entry IS the changelog
    # section, and a fragment would invent a version nobody publishes.
    if f"{package}CHANGELOG.md" in files:
        print("src/ changed and the changelog was edited directly")
        return 0
    print(
        "::error::this branch changes packages/selenium-devtools-py/src/ but "
        "documents nothing.\nAdd a fragment under "
        "packages/selenium-devtools-py/changes/ — see that directory's\nREADME "
        "— or edit CHANGELOG.md directly. Changed:\n  "
        + "\n  ".join(touched_src[:10]),
        file=sys.stderr,
    )
    return 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    check_cmd = sub.add_parser("check", help="fail if src/ changed with no fragment")
    check_cmd.add_argument("--base", required=True, help="the ref to compare against")
    sub.add_parser("next-version", help="print the version a release would publish")
    sub.add_parser("apply", help="consume fragments, bump the version and changelog")
    args = parser.parse_args(argv)

    try:
        if args.command == "check":
            return check(args.base)
        if args.command == "next-version":
            fragments = load_fragments()
            current = read_version()
            if not fragments:
                print(current)
                return 0
            print(next_version(current, highest_bump([b for _, b, _ in fragments])))
            return 0
        print(apply_release())
        return 0
    except ChangeError as exc:
        print(f"::error::{exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
