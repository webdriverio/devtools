"""The ``selenium-devtools`` command.

One job today: put the pinned dashboard backend on disk, so a test run starts a
server it already has instead of fetching one. See :mod:`backend_install` for
why that is a command rather than something ``pip install`` does.
"""

from __future__ import annotations

import argparse
import logging
import sys

from . import backend_install
from .constants import BACKEND_NPM_PACKAGE, BACKEND_NPM_VERSION


def _install(args: argparse.Namespace) -> int:
    server = backend_install.install(force=args.force)
    print(f"{BACKEND_NPM_PACKAGE}@{BACKEND_NPM_VERSION} ready at {server}")
    return 0


def _uninstall(_: argparse.Namespace) -> int:
    root = backend_install.install_root()
    if backend_install.uninstall():
        print(f"removed {root}")
        return 0
    print(f"nothing installed at {root}")
    return 0


def _where(_: argparse.Namespace) -> int:
    server = backend_install.installed_server()
    if server is None:
        print(
            f"{BACKEND_NPM_PACKAGE}@{BACKEND_NPM_VERSION} is not installed; runs "
            "will fetch it with npx. Install it once with:\n"
            "    selenium-devtools install-backend"
        )
        return 1
    print(server)
    return 0


def main(argv: "list[str] | None" = None) -> int:
    parser = argparse.ArgumentParser(
        prog="selenium-devtools",
        description="Helpers for the WebdriverIO DevTools Selenium adapter.",
    )
    subs = parser.add_subparsers(dest="command", required=True)

    install = subs.add_parser(
        "install-backend",
        help=f"install {BACKEND_NPM_PACKAGE}@{BACKEND_NPM_VERSION} for this adapter",
    )
    install.add_argument(
        "--force", action="store_true", help="reinstall even if it is already there"
    )
    install.set_defaults(func=_install)

    subs.add_parser(
        "uninstall-backend", help="remove the installed backend"
    ).set_defaults(func=_uninstall)

    subs.add_parser(
        "backend-path", help="print the installed backend's entry script"
    ).set_defaults(func=_where)

    args = parser.parse_args(argv)
    # The install talks to the network and npm talks back; without a handler the
    # module's own log lines would go nowhere and the command would look idle.
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    try:
        return args.func(args)
    except RuntimeError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":  # pragma: no cover - module entry
    raise SystemExit(main())
