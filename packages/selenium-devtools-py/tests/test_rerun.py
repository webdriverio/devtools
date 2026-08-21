"""The commands the dashboard's run controls spawn.

Every case here is a string the BACKEND will hand to a shell in a fresh
process, so the assertions are about the exact command text — there is no
runtime on our side to correct a template that came out wrong.
"""

import os
import sys
import unittest

from selenium_devtools import rerun
from selenium_devtools._contract import ENV_RUNNER_CWD, RERUN_SLOT_TEST_ID

PY = rerun._quote([sys.executable])
ROOT = "/repo"
# A path that really exists — `configure_script` refuses anything that is not a
# file, so a made-up path would make those cases pass for the wrong reason.
SCRIPT = os.path.abspath(__file__)


class RerunTestCase(unittest.TestCase):
    def setUp(self) -> None:
        rerun.reset()
        self._saved_cwd = os.environ.pop(ENV_RUNNER_CWD, None)
        self.addCleanup(self._restore)

    def _restore(self) -> None:
        rerun.reset()
        os.environ.pop(ENV_RUNNER_CWD, None)
        if self._saved_cwd is not None:
            os.environ[ENV_RUNNER_CWD] = self._saved_cwd

    def configure_pytest(self, args, positionals=(), rootdir=ROOT):
        rerun.configure_pytest(
            args=list(args), positionals=list(positionals), rootdir=rootdir
        )
        return rerun.run_options()


class TestPytestCommands(RerunTestCase):
    def test_the_rerun_template_ends_in_the_slot_the_backend_fills(self):
        options = self.configure_pytest(["tests/test_a.py"], ["tests/test_a.py"])

        # Bare, not quoted: the backend shell-quotes the id it substitutes, and
        # a pre-quoted slot would nest the quotes and select nothing.
        self.assertEqual(
            options["rerunCommand"], f"{PY} -m pytest {RERUN_SLOT_TEST_ID}"
        )

    def test_the_launch_command_keeps_the_whole_selection(self):
        options = self.configure_pytest(["tests/"], ["tests/"])

        self.assertEqual(
            options["launchCommand"],
            f"{PY} -m pytest {os.path.abspath('tests/')}",
        )

    def test_the_interpreter_is_this_one_not_whatever_python_resolves_to(self):
        # The rerun must run under the venv that has selenium and this adapter
        # installed. `python3` off the backend's PATH need not be that one.
        options = self.configure_pytest(["tests/"], ["tests/"])

        self.assertTrue(options["launchCommand"].startswith(PY))
        self.assertTrue(str(options["rerunCommand"]).startswith(PY))

    def test_a_nodeid_positional_is_dropped_so_reruns_do_not_stack(self):
        # The state a rerun's own child process is in: its argv carries the
        # nodeid the previous rerun selected. Left in place, pytest would union
        # it with the next one and each rerun would run one test more.
        options = self.configure_pytest(
            ["tests/test_a.py::TestLogin::test_valid"],
            ["tests/test_a.py::TestLogin::test_valid"],
        )

        self.assertEqual(
            options["rerunCommand"], f"{PY} -m pytest {RERUN_SLOT_TEST_ID}"
        )

    def test_options_that_do_not_select_tests_survive(self):
        options = self.configure_pytest(
            ["-p", "no:cacheprovider", "-x", "--maxfail=2", "tests/"], ["tests/"]
        )

        self.assertEqual(
            options["rerunCommand"],
            f"{PY} -m pytest -p no:cacheprovider -x --maxfail=2 "
            f"{RERUN_SLOT_TEST_ID}",
        )

    def test_an_options_value_is_never_mistaken_for_a_positional(self):
        # `no:cacheprovider` is not a path, and pytest does not report it as a
        # positional — dropping it while keeping `-p` would make `-p` swallow
        # the id appended after it.
        options = self.configure_pytest(["-p", "no:cacheprovider"], [])

        self.assertIn("-p no:cacheprovider", str(options["rerunCommand"]))


class TestSelectorsAreStripped(RerunTestCase):
    """A targeted rerun names its entry, so anything else that narrows the run
    can only narrow it further — usually to nothing, which pytest reports as a
    clean exit."""

    def assert_stripped(self, args):
        options = self.configure_pytest([*args, "tests/"], ["tests/"])
        self.assertEqual(
            options["rerunCommand"],
            f"{PY} -m pytest {RERUN_SLOT_TEST_ID}",
            f"{args} survived into the rerun template",
        )
        # …but the launch command re-runs what the user asked for.
        self.assertIn(args[0], str(options["launchCommand"]))

    def test_keyword_and_marker_filters(self):
        for args in (["-k", "login"], ["-m", "smoke"], ["-kloGin"], ["-msmoke"]):
            with self.subTest(args=args):
                self.assert_stripped(args)

    def test_deselect_in_both_forms(self):
        for args in (
            ["--deselect", "tests/test_a.py::test_x"],
            ["--deselect=tests/test_a.py::test_x"],
        ):
            with self.subTest(args=args):
                self.assert_stripped(args)

    def test_last_failed_and_stepwise_flags(self):
        for flag in ("--lf", "--last-failed", "--ff", "--sw", "--stepwise", "--nf"):
            with self.subTest(flag=flag):
                self.assert_stripped([flag])

    def test_xdist_parallelism(self):
        # A one-entry rerun has nothing to parallelise, and each worker would
        # connect to the dashboard as its own run.
        for args in (["-n", "4"], ["-nauto"], ["--numprocesses=4"], ["--dist", "load"]):
            with self.subTest(args=args):
                self.assert_stripped(args)


class TestCapabilitiesMatchWhatCanBeServiced(RerunTestCase):
    def test_pytest_can_service_every_control(self):
        options = self.configure_pytest(["tests/"], ["tests/"])

        self.assertEqual(
            options["runCapabilities"],
            {"canRunSuites": True, "canRunTests": True, "canRunAll": True},
        )

    def test_a_plain_script_can_rerun_its_one_entry(self):
        # A script's tree is one synthetic suite holding one synthetic test, and
        # both denote the whole run — so relaunching the script IS running that
        # row, and refusing those controls would disable the button beside the
        # only row there is.
        rerun.configure_script([SCRIPT])
        options = rerun.run_options()

        self.assertEqual(
            options["runCapabilities"],
            {"canRunSuites": True, "canRunTests": True, "canRunAll": True},
        )
        self.assertEqual(
            options["launchCommand"], f"{PY} {rerun._quote([SCRIPT])}"
        )

    def test_a_script_rerun_carries_no_slot_to_substitute(self):
        # There is nothing to select, so the template is the launch command
        # itself and the backend substitutes nothing into it.
        rerun.configure_script([SCRIPT])
        options = rerun.run_options()

        self.assertEqual(options["rerunCommand"], options["launchCommand"])
        self.assertNotIn(RERUN_SLOT_TEST_ID, str(options["rerunCommand"]))

    def test_a_script_that_is_not_a_file_publishes_nothing(self):
        # `python -c '...'` reports the flag itself as argv[0], and an
        # interactive session reports nothing. Either would advertise a Run-all
        # that reruns a path that does not exist.
        for argv in (["-c"], [""], []):
            with self.subTest(argv=argv):
                rerun.reset()
                rerun.configure_script(argv)

                self.assertNotIn("launchCommand", rerun.run_options())
                self.assertFalse(
                    any(rerun.run_options()["runCapabilities"].values())
                )

    def test_nothing_configured_refuses_everything(self):
        # The default has to be all-off: with no bag at all the app falls back
        # to all-true and the buttons render enabled.
        self.assertEqual(
            rerun.run_options(),
            {
                "runCapabilities": {
                    "canRunSuites": False,
                    "canRunTests": False,
                    "canRunAll": False,
                }
            },
        )

    def test_a_script_launch_never_overwrites_a_framework_one(self):
        # `enable()` calls configure_script unconditionally, and for a pytest
        # run the plugin has already published the better commands. The script
        # argv here is a real file, so only the already-published check can be
        # what stops it.
        self.configure_pytest(["tests/"], ["tests/"])
        rerun.configure_script([SCRIPT])

        self.assertIn("rerunCommand", rerun.run_options())
        self.assertTrue(rerun.run_options()["runCapabilities"]["canRunTests"])

    def test_reset_refuses_everything_again(self):
        self.configure_pytest(["tests/"], ["tests/"])
        rerun.reset()

        self.assertNotIn("launchCommand", rerun.run_options())


class TestTheDirectoryTheRerunSpawnsIn(RerunTestCase):
    def test_pytest_spawns_in_rootdir_because_nodeids_are_relative_to_it(self):
        self.configure_pytest(["tests/"], ["tests/"], rootdir=ROOT)

        self.assertEqual(os.environ[ENV_RUNNER_CWD], ROOT)

    def test_a_script_spawns_where_it_was_launched(self):
        rerun.configure_script([SCRIPT])

        self.assertEqual(os.environ[ENV_RUNNER_CWD], os.getcwd())

    def test_an_explicit_setting_is_left_alone(self):
        os.environ[ENV_RUNNER_CWD] = "/somewhere/else"

        self.configure_pytest(["tests/"], ["tests/"])

        self.assertEqual(os.environ[ENV_RUNNER_CWD], "/somewhere/else")


class TestQuoting(RerunTestCase):
    def test_a_path_with_a_space_survives_the_shell(self):
        options = self.configure_pytest(
            ["my tests/test_a.py"], ["my tests/test_a.py"]
        )

        self.assertIn(
            rerun._quote([os.path.abspath("my tests/test_a.py")]),
            str(options["launchCommand"]),
        )


if __name__ == "__main__":
    unittest.main()
