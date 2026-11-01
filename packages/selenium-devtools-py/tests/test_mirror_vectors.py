"""Runs ``packages/shared/mirror-vectors.json`` against the Python side of every
function this package mirrors from TypeScript. The TypeScript runner is
``packages/selenium-devtools/tests/mirror-vectors.test.ts``; a case added to
the file is checked by both."""

from __future__ import annotations

import json
import os
import re
import shutil
import tempfile
import unittest
from pathlib import Path
from typing import Any, Dict, List
from unittest import mock

from selenium.webdriver.support import expected_conditions as EC

from selenium_devtools import (
    _contract,
    capture_timing,
    capturer,
    device,
    output_dir,
    performance,
    read_value_locators,
    run_id,
    wait_tracking,
)


def _vectors_path() -> Path:
    for parent in Path(__file__).resolve().parents:
        candidate = parent / "packages" / "shared" / "mirror-vectors.json"
        if candidate.exists():
            return candidate
    raise RuntimeError("mirror-vectors.json not found; these tests run in the monorepo")


VECTORS = json.loads(_vectors_path().read_text(encoding="utf-8"))
SECTIONS: Dict[str, Any] = VECTORS["sections"]

RUNNERS = {
    "assertionTarget",
    "nativeSession",
    "runId",
    "outputDir",
    "commandRowId",
    "waitPollKeys",
    "nestedWaitIdentity",
    "performancePayload",
    "waitRowNaming",
    "captureTimingSummary",
}

UUID4 = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")


def _cases(name: str) -> List[Dict[str, Any]]:
    return SECTIONS[name]["cases"]


class TestEverySectionRuns(unittest.TestCase):
    def test_runs_every_section_the_vectors_file_declares(self):
        self.assertEqual(set(SECTIONS), RUNNERS)


class Grouping:
    def assert_same_grouping(self, observed: List[Any], names: List[str]) -> None:
        """Equal names exactly where the observed values are the same."""
        self.assertEqual(len(observed), len(names))  # type: ignore[attr-defined]
        for i in range(len(observed)):
            for j in range(i + 1, len(observed)):
                self.assertEqual(  # type: ignore[attr-defined]
                    observed[i] is observed[j] or observed[i] == observed[j],
                    names[i] == names[j],
                    f"items {i} and {j} ({names[i]}, {names[j]})",
                )


class TestAssertionTarget(unittest.TestCase):
    @staticmethod
    def _value(raw: Any) -> Any:
        if isinstance(raw, dict) and "$repeat" in raw:
            text, count = raw["$repeat"]
            return text * count
        return raw

    def test_cases(self):
        for case in _cases("assertionTarget"):
            with self.subTest(case["name"]):
                read_value_locators.reset()
                for step in case["steps"]:
                    if "remember" in step:
                        read_value_locators.remember(self._value(step["remember"]), step["selector"])
                    elif "rememberMany" in step:
                        many = step["rememberMany"]
                        for i in range(many["count"]):
                            read_value_locators.remember(f"{many['prefix']}{i}", many["selector"])
                    elif "lookup" in step:
                        self.assertEqual(
                            read_value_locators.selector_for(self._value(step["lookup"])),
                            step["expect"],
                            step,
                        )
                    else:
                        operands = [self._value(v) for v in step["resolve"]]
                        self.assertEqual(
                            read_value_locators.assertion_target(*operands), step["expect"], step
                        )
        read_value_locators.reset()


class TestNativeSession(unittest.TestCase):
    def test_cases(self):
        for case in _cases("nativeSession"):
            with self.subTest(case["name"]):
                caps = case["capabilities"]
                self.assertEqual(
                    {
                        "nativeApp": device.is_native_app_session(caps),
                        "platform": device.native_platform(caps),
                    },
                    case["expect"],
                )


class TestRunId(unittest.TestCase):
    def setUp(self):
        saved = os.environ.get(_contract.ENV_RUN_ID)
        ended = run_id._run_ended

        def restore():
            run_id._run_ended = ended
            if saved is None:
                os.environ.pop(_contract.ENV_RUN_ID, None)
            else:
                os.environ[_contract.ENV_RUN_ID] = saved

        self.addCleanup(restore)

    def test_publishes_to_the_variable_the_vectors_name(self):
        self.assertEqual(_contract.ENV_RUN_ID, SECTIONS["runId"]["envVar"])

    def test_cases(self):
        for case in _cases("runId"):
            with self.subTest(case["name"]):
                run_id._run_ended = False
                if case["env"] is None:
                    os.environ.pop(_contract.ENV_RUN_ID, None)
                else:
                    os.environ[_contract.ENV_RUN_ID] = case["env"]
                resolved = run_id.resolve_run_id()
                if case["expect"] == "inherited":
                    self.assertEqual(resolved, case["env"])
                else:
                    self.assertRegex(resolved, UUID4)
                    self.assertEqual(os.environ.get(_contract.ENV_RUN_ID), resolved)


class TestOutputDir(unittest.TestCase):
    def test_cases(self):
        for case in _cases("outputDir"):
            with self.subTest(case["name"]):
                root = os.path.realpath(tempfile.mkdtemp(prefix="mirror-vectors-"))
                self.addCleanup(self._remove, root)

                def at(rel: str) -> str:
                    return os.path.join(root, *rel.replace("<installed>", "site-packages").split("/"))

                for d in case["dirs"]:
                    os.makedirs(at(d), exist_ok=True)
                for d in case.get("readOnly", []):
                    os.chmod(at(d), 0o555)
                    if os.access(at(d), os.W_OK):
                        self.skipTest("running as a user that ignores directory modes")
                given = case["input"]
                kwargs = {
                    "user_configured_dir": given.get("userConfiguredDir"),
                    "test_file_path": given.get("testFilePath"),
                    "fallback_dir": given.get("fallbackDir"),
                }
                kwargs = {k: (at(v) if v else v) for k, v in kwargs.items()}
                self.assertEqual(output_dir.resolve_adapter_output_dir(**kwargs), at(case["expect"]))

    @staticmethod
    def _remove(root: str) -> None:
        for dirpath, _dirs, _files in os.walk(root):
            os.chmod(dirpath, 0o755)
        shutil.rmtree(root, ignore_errors=True)


class _Transport:
    connected = True

    def send_json(self, scope: str, data: Any) -> bool:
        return True

    def close(self) -> None:
        pass


class TestCommandRowId(unittest.TestCase):
    def test_cases(self):
        section = SECTIONS["commandRowId"]
        for case in section["cases"]:
            with self.subTest(case["name"]):
                bounds: List[int] = []

                def draw(bound: int, value: int = case["draw"]) -> int:
                    bounds.append(bound)
                    return value

                with mock.patch.object(capturer.secrets, "randbelow", draw):
                    session = capturer.SessionCapturer(_Transport())
                self.assertEqual(bounds, [section["randomBound"]])
                ids = [
                    session.capture_command(command="click", args=[], start_time=0, call_source=None)["id"]
                    for _ in case["ids"]
                ]
                self.assertEqual(ids, case["ids"])
                self.assertEqual(case["ids"][0], case["draw"] * section["rowsPerProcess"])
                self.assertLess(case["ids"][-1], 2**53)


class _FakeWait:
    """Stands in for ``WebDriverWait``: evaluates its condition once per poll."""

    polls = 1

    def __init__(self, polls: int = 1) -> None:
        self.polls = polls

    def until(self, method: Any, message: str = "") -> Any:
        for _ in range(self.polls):
            method(None)
        return True

    def until_not(self, method: Any, message: str = "") -> Any:
        return self.until(method, message)


class _WaitTracking(unittest.TestCase):
    def setUp(self):
        wait_tracking.uninstall()
        package_dir = os.path.dirname(wait_tracking.__file__)
        wait_tracking.install(object(), lambda: (package_dir,), _FakeWait)
        self.addCleanup(wait_tracking.uninstall)


class TestWaitPollKeys(_WaitTracking, Grouping):
    @staticmethod
    def _poll(call: Dict[str, Any]) -> Any:
        return wait_tracking.poll_of(call["command"], call["args"], call["selector"])

    def test_cases(self):
        for case in _cases("waitPollKeys"):
            with self.subTest(case["name"]):
                if "outsideWait" in case:
                    for call in case["outsideWait"]:
                        self.assertIsNone(self._poll(call))
                    continue
                polls = case["polls"]
                keys: List[str] = []
                scopes: List[Any] = []
                index = iter(polls)

                def condition(_driver: Any) -> None:
                    for call in next(index):
                        scope, key = self._poll(call)
                        keys.append(key)
                        scopes.append(scope)

                _FakeWait(len(polls)).until(condition)
                self.assertTrue(all(s is scopes[0] for s in scopes))
                self.assert_same_grouping(keys, [n for poll in case["expect"] for n in poll])


class TestNestedWaitIdentity(_WaitTracking, Grouping):
    def test_cases(self):
        observed: List[Any] = []

        def record() -> bool:
            observed.append(wait_tracking.poll_of("probe", [], None)[0])
            return True

        # Anonymous, with different bodies: only their code tells them apart.
        conditions = {
            "A": lambda _d: record() and "A",
            "B": lambda _d: record() and "B",
            "C": lambda _d: record() and "C",
        }

        def start_inner(condition_id: str) -> None:
            _FakeWait().until(conditions[condition_id])

        for case in _cases("nestedWaitIdentity"):
            with self.subTest(case["name"]):
                observed.clear()
                outer_polls = iter(case["outerPolls"])

                def outer(_driver: Any) -> None:
                    for condition_id in next(outer_polls):
                        start_inner(condition_id)

                _FakeWait(len(case["outerPolls"])).until(outer)
                self.assert_same_grouping(list(observed), [n for poll in case["expect"] for n in poll])


def _without_nulls(value: Any) -> Any:
    """null and absent are one state on the wire; see the section's notes."""
    if isinstance(value, dict):
        return {k: _without_nulls(v) for k, v in value.items() if v is not None}
    if isinstance(value, list):
        return [_without_nulls(v) for v in value]
    return value


class TestPerformancePayload(unittest.TestCase):
    def test_cases(self):
        for case in _cases("performancePayload"):
            with self.subTest(case["name"]):
                row: Dict[str, Any] = {"command": "url"}
                applied = performance.apply_performance_data(row, case["payload"], case["navigatedUrl"])
                self.assertEqual({"applied": applied, "row": _without_nulls(row)}, case["expect"])


class TestWaitRowNaming(unittest.TestCase):
    FACTORIES = {
        "elementLocated": EC.presence_of_element_located,
        "elementVisible": EC.visibility_of_element_located,
    }

    def _condition(self, given: Dict[str, Any]) -> Any:
        if given["factory"] == "titleIs":
            return EC.title_is("Home")
        if given["factory"] == "function":
            return lambda _driver: True
        locator = given["locator"]
        return self.FACTORIES[given["factory"]]((locator["using"], locator["value"]))

    def test_cases(self):
        for case in _cases("waitRowNaming"):
            with self.subTest(case["name"]):
                given = case["condition"]
                command, selector = wait_tracking.wait_row_name(
                    self._condition(given), given.get("negated", False)
                )
                self.assertEqual({"command": command, "selector": selector}, case["expect"])


class TestCaptureTimingSummary(unittest.TestCase):
    def test_cases(self):
        for case in _cases("captureTimingSummary"):
            with self.subTest(case["name"]):
                summary = capture_timing.summarize(case["records"], case["wall"])
                self.assertEqual(
                    {
                        "summary": summary,
                        "formatted": capture_timing.format_summary(summary, case["file"]),
                    },
                    case["expect"],
                )


if __name__ == "__main__":
    unittest.main()
