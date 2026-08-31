"""The element-handle → selector registry that feeds the player's overlay."""

from __future__ import annotations

import unittest

from selenium_devtools import element_locators
from selenium_devtools.constants import ELEMENT_LOCATOR_CACHE_SIZE


class _Handle:
    """A WebElement as far as this module is concerned: something with an id."""

    def __init__(self, element_id: str) -> None:
        self.id = element_id


class LocatorToSelectorTest(unittest.TestCase):
    def test_it_maps_the_strategies_that_have_a_selector_form(self):
        for using, value, expected in (
            ("css selector", "#username", "#username"),
            ("css selector", ".row > a", ".row > a"),
            ("xpath", '//button[contains(., "Login")]', '//button[contains(., "Login")]'),
            ("tag name", "button", "button"),
        ):
            with self.subTest(using=using, value=value):
                self.assertEqual(element_locators.locator_to_selector(using, value), expected)

    def test_it_canonicalizes_the_css_form_By_ID_compiles_to(self):
        # selenium's LocatorConverter turns By.ID into `[id="x"]`, while the
        # captured element records carry `#x` and are compared by string.
        self.assertEqual(
            element_locators.locator_to_selector("css selector", '[id="username"]'),
            "#username",
        )
        self.assertEqual(
            element_locators.locator_to_selector("css selector", '*[id="username"]'),
            "#username",
        )

    def test_it_leaves_an_attribute_selector_that_is_not_an_id_alone(self):
        self.assertEqual(
            element_locators.locator_to_selector("css selector", '[name="q"]'),
            '[name="q"]',
        )

    def test_it_declines_strategies_with_no_selector_equivalent(self):
        for using, value in (
            ("link text", "Logout"),
            ("partial link text", "Log"),
            ("css selector", ""),
            (None, "#x"),
            ("css selector", None),
        ):
            with self.subTest(using=using, value=value):
                self.assertIsNone(element_locators.locator_to_selector(using, value))


class SelectorForCommandTest(unittest.TestCase):
    def setUp(self):
        element_locators.reset()
        self.addCleanup(element_locators.reset)

    def test_a_find_remembers_its_locator_for_the_handle_it_produced(self):
        found = _Handle("f.93A.e.3")
        self.assertEqual(
            element_locators.selector_for_command(
                "findElement", {"using": "css selector", "value": '[id="username"]'}, found
            ),
            "#username",
        )
        # The click that follows sees only the handle.
        self.assertEqual(
            element_locators.selector_for_command("clickElement", {"id": "f.93A.e.3"}),
            "#username",
        )
        self.assertEqual(
            element_locators.selector_for_command(
                "sendKeysToElement", {"id": "f.93A.e.3", "text": "tomsmith"}
            ),
            "#username",
        )

    def test_every_handle_a_plural_find_returned_is_remembered(self):
        element_locators.selector_for_command(
            "findElements",
            {"using": "css selector", "value": ".row"},
            [_Handle("e.1"), _Handle("e.2")],
        )
        self.assertEqual(
            element_locators.selector_for_command("clickElement", {"id": "e.2"}), ".row"
        )

    def test_a_child_find_is_scoped_to_its_parent(self):
        element_locators.selector_for_command(
            "findElement", {"using": "css selector", "value": "#form"}, _Handle("e.1")
        )
        self.assertEqual(
            element_locators.selector_for_command(
                "findChildElement",
                {"id": "e.1", "using": "css selector", "value": ".row"},
                _Handle("e.2"),
            ),
            "#form .row",
        )

    def test_an_xpath_child_is_not_concatenated(self):
        element_locators.selector_for_command(
            "findElement", {"using": "css selector", "value": "#form"}, _Handle("e.1")
        )
        self.assertEqual(
            element_locators.selector_for_command(
                "findChildElement",
                {"id": "e.1", "using": "xpath", "value": "//a"},
                _Handle("e.2"),
            ),
            "//a",
        )

    def test_a_child_of_an_unknown_parent_keeps_its_own_selector(self):
        self.assertEqual(
            element_locators.selector_for_command(
                "findChildElement",
                {"id": "never-seen", "using": "css selector", "value": ".row"},
                _Handle("e.2"),
            ),
            ".row",
        )

    def test_an_unmapped_strategy_remembers_nothing(self):
        found = _Handle("e.9")
        self.assertIsNone(
            element_locators.selector_for_command(
                "findElement", {"using": "link text", "value": "Logout"}, found
            )
        )
        self.assertIsNone(
            element_locators.selector_for_command("clickElement", {"id": "e.9"})
        )

    def test_an_unseen_handle_and_a_non_element_command_yield_nothing(self):
        self.assertIsNone(
            element_locators.selector_for_command("clickElement", {"id": "unknown"})
        )
        self.assertIsNone(element_locators.selector_for_command("get", {"url": "http://x"}))
        self.assertIsNone(element_locators.selector_for_command("getTitle", None))

    def test_a_frame_switch_by_index_is_not_read_as_a_handle(self):
        # `switchToFrame` also takes `id`, as an index or a serialized element.
        self.assertIsNone(element_locators.selector_for_command("switchToFrame", {"id": 0}))
        self.assertIsNone(
            element_locators.selector_for_command(
                "switchToFrame", {"id": {"element-6066-11e4-a52e-4f735466cecf": "e.1"}}
            )
        )

    def test_the_registry_is_bounded_and_evicts_the_oldest(self):
        for i in range(ELEMENT_LOCATOR_CACHE_SIZE + 10):
            element_locators.selector_for_command(
                "findElement",
                {"using": "css selector", "value": f"#e{i}"},
                _Handle(f"e.{i}"),
            )
        self.assertIsNone(element_locators.selector_for_command("clickElement", {"id": "e.0"}))
        newest = f"e.{ELEMENT_LOCATOR_CACHE_SIZE + 9}"
        self.assertEqual(
            element_locators.selector_for_command("clickElement", {"id": newest}),
            f"#e{ELEMENT_LOCATOR_CACHE_SIZE + 9}",
        )

    def test_reset_drops_handles_so_a_re_enable_cannot_serve_a_stale_selector(self):
        element_locators.selector_for_command(
            "findElement", {"using": "css selector", "value": "#a"}, _Handle("e.1")
        )
        element_locators.reset()
        self.assertIsNone(element_locators.selector_for_command("clickElement", {"id": "e.1"}))


if __name__ == "__main__":
    unittest.main()
