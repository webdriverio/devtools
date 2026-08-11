Feature: Example site smoke test

  Mirrors the Nightwatch BDD smoke-test: open a site, wait for the body to be
  visible, and assert the page title. Runs as a Cucumber scenario so the
  cross-adapter harness has a nightwatch-cucumber trace fixture.

  Scenario Outline: I can open a site and read its title
    Given I navigate to "<url>"
    When the page body becomes visible
    Then the page title contains "<title>"

    Examples:
      | url                    | title   |
      | https://example.com    | Example |
      | https://example.org    | Example |
