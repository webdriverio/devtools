"""The pytest plugin's config surface: CLI flags, ini options, env fallback.

The precedence matrix runs against a stand-in config, because it is pure logic.
What a stand-in cannot prove — that the options register at all, that
`addini(default=None)` really yields None for an unset option, and that pytest's
own `-o` override reaches us — is checked by running real pytest in a subprocess.
"""

from __future__ import annotations

import os
import pathlib
import subprocess
import sys
import tempfile
import textwrap
import unittest
from unittest import mock

from selenium_devtools import pytest_plugin as plugin

SRC = str(pathlib.Path(__file__).resolve().parents[1] / "src")
_DEVTOOLS_ENV = ("DEVTOOLS_ENABLE", "DEVTOOLS_PORT", "DEVTOOLS_TRACE")


class _Config:
    """pytest's `config`, reduced to what the resolvers ask of it.

    Both accessors return None for "not given", which is what registering every
    option with `default=None` buys — and the whole reason a precedence chain is
    expressible rather than three sources ORed together.
    """

    def __init__(self, options=None, ini=None):
        self._options = options or {}
        self._ini = ini or {}

    def getoption(self, name, default=None):
        return self._options.get(name, default)

    def getini(self, name):
        return self._ini.get(name)


class ResolveEnabledTest(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch.dict(os.environ, {}, clear=False)
        patcher.start()
        self.addCleanup(patcher.stop)
        for name in _DEVTOOLS_ENV:
            os.environ.pop(name, None)

    def test_nothing_anywhere_stays_inert(self):
        # Installing the package must never change how an existing suite behaves.
        self.assertFalse(plugin._resolve_enabled(_Config()))

    def test_the_cli_flag_enables(self):
        self.assertTrue(plugin._resolve_enabled(_Config({"--devtools": True})))

    def test_the_ini_option_enables(self):
        self.assertTrue(plugin._resolve_enabled(_Config(ini={"devtools": True})))

    def test_the_environment_still_enables(self):
        # CI and the pnpm demo scripts use these; removing them breaks setups
        # that already exist.
        for name in ("DEVTOOLS_ENABLE", "DEVTOOLS_PORT"):
            with self.subTest(env=name):
                os.environ.pop("DEVTOOLS_ENABLE", None)
                os.environ.pop("DEVTOOLS_PORT", None)
                os.environ[name] = "1"
                self.assertTrue(plugin._resolve_enabled(_Config()))

    def test_asking_for_a_trace_is_asking_for_capture(self):
        self.assertTrue(plugin._resolve_enabled(_Config({"--devtools-trace": True})))
        self.assertTrue(plugin._resolve_enabled(_Config(ini={"devtools_trace": True})))

    def test_the_trace_env_var_alone_does_not_enable(self):
        # It is a mode fallback a user may have exported for their own scripts;
        # reading it as an opt-in captures pytest runs nobody asked for.
        os.environ["DEVTOOLS_TRACE"] = "1"
        self.assertFalse(plugin._resolve_enabled(_Config()))

    def test_collect_only_captures_nothing(self):
        # Nothing runs, so opting in would launch a backend and leave a dashboard
        # window sitting empty for a run that never happened.
        for source in ({"--devtools": True}, {"--devtools-trace": True}):
            with self.subTest(source=source):
                config = _Config({**source, "--collect-only": True})
                self.assertFalse(plugin._resolve_enabled(config))
        os.environ["DEVTOOLS_ENABLE"] = "1"
        self.assertFalse(
            plugin._resolve_enabled(_Config({"--collect-only": True}))
        )
        self.assertFalse(
            plugin._resolve_enabled(
                _Config({"--collect-only": True}, {"devtools": True})
            )
        )

    def test_the_cli_beats_an_ini_that_says_no(self):
        self.assertTrue(
            plugin._resolve_enabled(
                _Config({"--devtools": True}, {"devtools": False})
            )
        )

    def test_an_ini_that_says_no_beats_the_environment(self):
        os.environ["DEVTOOLS_ENABLE"] = "1"
        self.assertFalse(plugin._resolve_enabled(_Config(ini={"devtools": False})))

    def test_a_trace_ini_that_says_no_leaves_the_environment_to_answer(self):
        # `devtools_trace = false` picks a MODE; it is not a refusal to capture.
        os.environ["DEVTOOLS_ENABLE"] = "1"
        self.assertTrue(
            plugin._resolve_enabled(_Config(ini={"devtools_trace": False}))
        )


class ResolveTraceTest(unittest.TestCase):
    def test_undecided_is_none_so_enable_reads_the_environment(self):
        # The env layer lives in `enable()`; duplicating it here would give
        # DEVTOOLS_TRACE two readers that could disagree.
        self.assertIsNone(plugin._resolve_trace(_Config()))

    def test_the_cli_flag_selects_trace_mode(self):
        self.assertTrue(plugin._resolve_trace(_Config({"--devtools-trace": True})))

    def test_the_ini_option_selects_it(self):
        self.assertTrue(plugin._resolve_trace(_Config(ini={"devtools_trace": True})))

    def test_an_ini_that_says_no_is_an_answer_not_a_shrug(self):
        self.assertIs(plugin._resolve_trace(_Config(ini={"devtools_trace": False})), False)


class ConfigureResolvesOnceTest(unittest.TestCase):
    """Most hooks are handed no `config`, so the answer has to be cached."""

    def setUp(self):
        self._was = plugin._enabled
        self.addCleanup(lambda: setattr(plugin, "_enabled", self._was))

    def test_opted_in_reports_what_configure_resolved(self):
        plugin._enabled = False
        with mock.patch.object(plugin, "_resolve_enabled", return_value=True), \
                mock.patch.object(plugin, "_enable_assertion_pass_hook"), \
                mock.patch.object(plugin, "_configure_rerun"), \
                mock.patch.object(plugin.devtools, "enable", return_value=None), \
                mock.patch.object(plugin.devtools, "dashboard_url", return_value=None):
            plugin.pytest_configure(_Config())

        self.assertTrue(plugin._opted_in())

    def test_a_run_that_did_not_opt_in_leaves_every_hook_inert(self):
        plugin._enabled = True
        with mock.patch.object(plugin, "_resolve_enabled", return_value=False), \
                mock.patch.object(plugin.devtools, "enable") as enable:
            plugin.pytest_configure(_Config())

        self.assertFalse(plugin._opted_in())
        enable.assert_not_called()

    def test_the_resolved_mode_is_what_enable_is_asked_for(self):
        with mock.patch.object(plugin, "_resolve_enabled", return_value=True), \
                mock.patch.object(plugin, "_resolve_trace", return_value=True), \
                mock.patch.object(plugin, "_enable_assertion_pass_hook"), \
                mock.patch.object(plugin, "_configure_rerun"), \
                mock.patch.object(plugin.devtools, "enable", return_value=None) as enable, \
                mock.patch.object(plugin.devtools, "dashboard_url", return_value=None):
            plugin.pytest_configure(_Config())

        enable.assert_called_once_with(trace=True)


class EmptyRunTest(unittest.TestCase):
    """`configure` opens the window before collection, so a run that collects
    nothing has to undo it — otherwise `sessionfinish` parks on an empty
    dashboard and a mistyped path blocks the terminal."""

    def setUp(self):
        self._was = plugin._enabled
        self.addCleanup(lambda: setattr(plugin, "_enabled", self._was))
        plugin._enabled = True

    def test_collecting_nothing_tears_the_run_down(self):
        with mock.patch.object(plugin.devtools, "disable") as disable:
            plugin.pytest_collection_finish(mock.Mock(items=[]))

        disable.assert_called_once()
        self.assertFalse(plugin._opted_in())

    def test_a_teardown_that_throws_never_fails_the_run(self):
        with mock.patch.object(plugin.devtools, "disable", side_effect=OSError("x")):
            plugin.pytest_collection_finish(mock.Mock(items=[]))

        self.assertFalse(plugin._opted_in())

    def test_a_run_with_tests_is_left_alone(self):
        item = mock.Mock(nodeid="t.py::a", location=("t.py", 1, "a"))
        with mock.patch.object(plugin.devtools, "disable") as disable, \
                mock.patch.object(plugin.devtools, "get_capturer", return_value=None):
            plugin.pytest_collection_finish(mock.Mock(items=[item]))

        disable.assert_not_called()
        self.assertTrue(plugin._opted_in())


def _pytest_available() -> bool:
    try:
        import pytest  # noqa: F401
    except ImportError:
        return False
    return True


@unittest.skipUnless(_pytest_available(), "needs pytest to drive a real config")
class RealPytestTest(unittest.TestCase):
    """What a stand-in config cannot prove: that the options exist."""

    @classmethod
    def setUpClass(cls):
        cls._dir = tempfile.TemporaryDirectory()
        d = pathlib.Path(cls._dir.name)
        (d / "test_probe.py").write_text("def test_one():\n    assert True\n")
        (d / "conftest.py").write_text(
            textwrap.dedent(
                """
                from selenium_devtools import pytest_plugin as plugin
                def pytest_configure(config):
                    print(f"RESOLVED={plugin._resolve_enabled(config)}"
                          f",{plugin._resolve_trace(config)}")
                """
            )
        )
        cls._path = d

    @classmethod
    def tearDownClass(cls):
        cls._dir.cleanup()

    def _run(self, *args, ini="[pytest]\n", env=None):
        (self._path / "pytest.ini").write_text(ini)
        environ = {k: v for k, v in os.environ.items() if k not in _DEVTOOLS_ENV}
        environ["PYTHONPATH"] = SRC
        environ.update(env or {})
        out = subprocess.run(
            [sys.executable, "-m", "pytest", "-p", "no:cacheprovider", "-q", "-s",
             *args, "test_probe.py"],
            cwd=self._path, env=environ, capture_output=True, text=True,
        )
        for line in (out.stdout + out.stderr).splitlines():
            if line.startswith("RESOLVED="):
                return line[len("RESOLVED="):].split(",")
        self.fail(f"no resolution reported:\n{out.stdout}\n{out.stderr}")

    def test_the_flags_are_registered_and_documented(self):
        out = subprocess.run(
            [sys.executable, "-m", "pytest", "-p", "no:cacheprovider", "--help"],
            cwd=self._path, env={**os.environ, "PYTHONPATH": SRC},
            capture_output=True, text=True,
        ).stdout

        self.assertIn("--devtools", out)
        self.assertIn("--devtools-trace", out)
        # Undiscoverable is the whole complaint in #339; `pytest --help` showing
        # nothing is what an env var could never fix.
        self.assertIn("devtools_trace (bool)", out)

    def test_an_unset_ini_option_really_reads_as_none(self):
        # addini(default=None). Were it pytest's usual `False`, an unset option
        # would look like an explicit no and shut the env layer out.
        self.assertEqual(self._run(env={"DEVTOOLS_ENABLE": "1"}), ["True", "None"])

    def test_the_ini_options_parse_as_booleans(self):
        self.assertEqual(
            self._run(ini="[pytest]\ndevtools_trace = true\n"), ["True", "True"]
        )

    def test_collect_only_does_not_start_a_backend(self):
        self.assertEqual(self._run("--collect-only", "--devtools")[0], "False")

    def test_pytests_own_override_switches_it_off_for_one_run(self):
        # Why there is no --no-devtools: pytest already ships the spelling.
        self.assertEqual(
            self._run("-o", "devtools=false", ini="[pytest]\ndevtools = true\n"),
            ["False", "None"],
        )


if __name__ == "__main__":
    unittest.main()
