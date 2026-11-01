"""Assertion rows: operand mapping and the wire shape.

Pure — no pytest-inside-pytest. The hooks themselves are exercised in
test_pytest_plugin.py against fake hook arguments.
"""

import sys
import unittest

from selenium_devtools import assertions


class TestWhichOperandIsWhich(unittest.TestCase):
    """`assert actual == expected` puts the observation on the LEFT, but
    `assert expected in actual` puts it on the right. Getting this backwards
    silently swaps both values on every containment row, which reads as a real
    result rather than as a bug."""

    def test_a_comparison_reads_left_as_the_observed_value(self):
        self.assertEqual(
            assertions.expected_and_actual("==", "Example Domain", "Example Domain"),
            ("Example Domain", "Example Domain"),
        )
        # Distinct values make the direction visible.
        self.assertEqual(
            assertions.expected_and_actual("==", "got", "wanted"), ("wanted", "got")
        )

    def test_containment_reads_left_as_the_expectation(self):
        expected, actual = assertions.expected_and_actual(
            "in", "/secure", "https://example.com/secure"
        )

        self.assertEqual(expected, "/secure")
        self.assertEqual(actual, "https://example.com/secure")

    def test_negated_containment_matches_containment(self):
        self.assertEqual(
            assertions.expected_and_actual("not in", "/admin", "https://x/secure"),
            ("/admin", "https://x/secure"),
        )

    def test_an_unknown_operator_falls_back_to_comparison_order(self):
        # New operators should read like `==` rather than raise: a wrong-way-round
        # row is recoverable, a broken run is not.
        self.assertEqual(
            assertions.expected_and_actual(">=", 5, 3), (3, 5)
        )


class TestTheWireShape(unittest.TestCase):
    def test_a_passing_comparison_carries_both_values(self):
        result = assertions.collapsed_result(
            passed=True, op="==", left="Example Domain", right="Example Domain"
        )

        self.assertEqual(
            result,
            {"passed": True, "expected": "Example Domain", "actual": "Example Domain"},
        )

    def test_a_failing_comparison_is_marked_failed(self):
        # The app reads `passed: False` as the row having failed — this is what
        # renders an assertion red rather than as an ordinary command.
        result = assertions.collapsed_result(
            passed=False, op="in", left="/secure", right="https://example.com/login"
        )

        self.assertIs(result["passed"], False)
        self.assertEqual(result["expected"], "/secure")
        self.assertEqual(result["actual"], "https://example.com/login")

    def test_a_non_comparison_carries_no_operands(self):
        # `assert x` has no two sides. Reporting expected/actual as None would
        # render two empty fields as though the values were missing.
        result = assertions.collapsed_result(passed=True)

        self.assertEqual(result, {"passed": True})
        self.assertNotIn("expected", result)
        self.assertNotIn("actual", result)

    def test_a_message_is_included_when_present(self):
        result = assertions.collapsed_result(passed=False, message="boom")

        self.assertEqual(result, {"passed": False, "message": "boom"})

    def test_an_empty_message_is_omitted(self):
        self.assertNotIn("message", assertions.collapsed_result(passed=True, message=""))


class TestTheComparisonBuffer(unittest.TestCase):
    """pytest reports a comparison's operands and its outcome through two
    separate hooks with nothing tying them together, so the row takes whatever is
    newest — and must consume it."""

    def setUp(self):
        self.buffer = assertions.ComparisonBuffer()

    def test_it_hands_over_the_most_recent_comparison(self):
        self.buffer.record("==", "a", "b")
        self.buffer.record("in", "x", "xyz")

        self.assertEqual(self.buffer.take(), ("in", "x", "xyz"))

    def test_taking_consumes_it(self):
        # A stale comparison attached to a later assertion is worse than no
        # values: it looks authoritative and is wrong.
        self.buffer.record("==", "a", "b")

        self.assertIsNotNone(self.buffer.take())
        self.assertIsNone(self.buffer.take())

    def test_an_empty_buffer_hands_over_nothing(self):
        self.assertIsNone(self.buffer.take())

    def test_clearing_discards_an_unclaimed_comparison(self):
        # A non-assertion failure clears it, so the next assertion cannot inherit
        # operands from a comparison that belonged to something else.
        self.buffer.record("==", "a", "b")
        self.buffer.clear()

        self.assertIsNone(self.buffer.take())



class TestReadingOperandsFromAScriptsAssert(unittest.TestCase):
    """A plain script's `assert` is never rewritten, so the values are recovered
    from the source line plus the frame that failed."""

    def test_a_literal_and_a_local_are_resolved(self):
        flash = "You logged into a secure area!"  # noqa: F841 — read via the frame
        source, operands = assertions.parse_assert_statement(
            'assert "You logged into a secure area1" in flash, flash',
            sys._getframe(),
        )

        self.assertEqual(source, "'You logged into a secure area1' in flash")
        self.assertEqual(
            operands, ("in", "You logged into a secure area1", flash)
        )

    def test_the_message_half_is_not_part_of_the_condition(self):
        # `assert cond, msg` — the row's label is the condition; including the
        # message expression made it read as though it were part of the test.
        source, _ = assertions.parse_assert_statement("assert a == 1, a", None)

        self.assertEqual(source, "a == 1")

    def test_an_attribute_operand_is_never_evaluated(self):
        """The guard that matters most.

        `assert "/secure" in driver.current_url` would re-issue a WebDriver
        command if this evaluated it — a phantom row at best, a changed page at
        worst. The values are worth having; not that much.
        """
        reads = []

        class Driver:
            @property
            def current_url(self):
                reads.append(1)
                return "https://example.com/login"

        driver = Driver()  # noqa: F841 — resolved via the frame if at all
        source, operands = assertions.parse_assert_statement(
            'assert "/secure" in driver.current_url', sys._getframe()
        )

        self.assertEqual(source, "'/secure' in driver.current_url")
        self.assertEqual(reads, [])  # provably nothing was read

        # The literal still reports — `in` puts the expectation on the left —
        # while the side that would have re-run reaches the wire as nothing.
        op, left, right = operands
        result = assertions.collapsed_result(passed=True, op=op, left=left, right=right)
        self.assertEqual(result["expected"], "/secure")
        self.assertNotIn("actual", result)

    def test_a_call_operand_is_never_evaluated(self):
        calls = []

        def value():
            calls.append(1)
            return "x"

        source, operands = assertions.parse_assert_statement(
            "assert value() == 'x'", sys._getframe()
        )

        # The call is never made; the literal side still reports.
        self.assertEqual(calls, [])
        self.assertIsNotNone(source)
        op, left, right = operands
        self.assertEqual((op, right), ("==", "x"))
        result = assertions.collapsed_result(passed=False, op=op, left=left, right=right)
        # `==` puts the expectation on the right; the call's value would have
        # been the actual, and it is absent rather than invented.
        self.assertEqual(result["expected"], "x")
        self.assertNotIn("actual", result)

    def test_a_non_comparison_yields_its_source_only(self):
        source, operands = assertions.parse_assert_statement("assert items", None)

        self.assertEqual(source, "items")
        self.assertIsNone(operands)

    def test_a_chained_comparison_is_left_alone(self):
        # Two operators, three operands — there is no single expected/actual pair
        # to report, and picking one would be a guess.
        source, operands = assertions.parse_assert_statement("assert 1 < x < 9", None)

        self.assertEqual(source, "1 < x < 9")
        self.assertIsNone(operands)

    def test_an_unknown_name_reports_only_the_side_it_knows(self):
        _, operands = assertions.parse_assert_statement("assert missing == 1", None)

        op, left, right = operands
        result = assertions.collapsed_result(passed=False, op=op, left=left, right=right)
        # `==` puts the expectation on the right, which is the readable side.
        self.assertEqual(result["expected"], 1)
        self.assertNotIn("actual", result)

    def test_neither_side_readable_yields_the_source_only(self):
        _, operands = assertions.parse_assert_statement("assert missing == absent", None)

        self.assertIsNone(operands)

    def test_an_unparseable_line_still_labels_the_row(self):
        # A continuation line reaches this as a fragment; the text is better than
        # an empty row.
        source, operands = assertions.parse_assert_statement("assert (", None)

        self.assertEqual(source, "(")
        self.assertIsNone(operands)

    def test_a_line_that_is_not_an_assert_passes_its_text_through(self):
        source, operands = assertions.parse_assert_statement("raise RuntimeError()", None)

        self.assertEqual(source, "raise RuntimeError()")
        self.assertIsNone(operands)

    def test_the_innermost_frame_is_where_the_locals_are(self):
        def inner():
            marker = "here"  # noqa: F841
            raise AssertionError("boom")

        try:
            inner()
        except AssertionError as exc:
            frame = assertions.innermost_frame(exc)

        self.assertEqual(frame.f_locals.get("marker"), "here")

    def test_no_traceback_yields_no_frame(self):
        self.assertIsNone(assertions.innermost_frame(AssertionError("never raised")))



class TestTheMessageIsNotARepeat(unittest.TestCase):
    """`assert cond, msg` makes the error message whatever `msg` evaluated to,
    and `assert needle in haystack, haystack` is the idiomatic form — so the
    message is usually the actual value, and rendering both shows it twice."""

    def test_a_message_equal_to_the_actual_is_dropped(self):
        result = assertions.collapsed_result(
            passed=False, op="in", left="/secure", right="/login", message="/login"
        )

        self.assertEqual(result["actual"], "/login")
        self.assertNotIn("message", result)

    def test_a_message_equal_to_the_expected_is_dropped(self):
        result = assertions.collapsed_result(
            passed=False, op="in", left="/secure", right="/login", message="/secure"
        )

        self.assertNotIn("message", result)

    def test_a_message_that_says_something_new_is_kept(self):
        result = assertions.collapsed_result(
            passed=False, op="==", left=1, right=2, message="counts diverged"
        )

        self.assertEqual(result["message"], "counts diverged")

    def test_a_message_survives_when_there_are_no_operands(self):
        # `assert x, "why"` has nothing to be redundant with.
        result = assertions.collapsed_result(passed=False, message="why")

        self.assertEqual(result["message"], "why")

    def test_a_non_string_actual_is_compared_by_its_text(self):
        # The message is always a string; the value need not be.
        result = assertions.collapsed_result(
            passed=False, op="==", left=404, right=200, message="404"
        )

        self.assertNotIn("message", result)


if __name__ == "__main__":
    unittest.main()


class AssertCommandNameTest(unittest.TestCase):
    """The name has to resolve in shared's ACTION_MAP, which matches
    `^(?:assert|verify|expect)\\.(\\w+)$`. A bare "assert" is silently dropped by
    the trace exporter, so the row showed in live mode and in no trace."""

    def test_every_name_is_dotted(self):
        for op in ("==", "!=", "is", "is not", "<", ">=", "in", "not in", None, ""):
            with self.subTest(op=op):
                name = assertions.assert_command(op)
                self.assertRegex(name, r"^assert\.\w+$")

    def test_comparisons_are_named_as_node_assert_methods(self):
        self.assertEqual(assertions.assert_command("=="), "assert.equal")
        self.assertEqual(assertions.assert_command("!="), "assert.notEqual")
        self.assertEqual(assertions.assert_command("is"), "assert.strictEqual")
        self.assertEqual(assertions.assert_command("is not"), "assert.notStrictEqual")

    def test_anything_without_an_equivalent_is_a_truthiness_check(self):
        # node:assert calls a bare truthiness check `ok`; the orderings and
        # containment have no direct method, and the source text carries the
        # meaning on the row's args either way.
        for op in ("<", "<=", ">", ">=", "in", "not in", None):
            with self.subTest(op=op):
                self.assertEqual(assertions.assert_command(op), "assert.ok")

    def test_the_default_constant_is_dotted_too(self):
        self.assertRegex(assertions.ASSERT_COMMAND, r"^assert\.\w+$")
