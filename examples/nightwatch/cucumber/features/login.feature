Feature: the-internet login flow

  Mirrors the Selenium cucumber example's feature so the cross-adapter harness
  has a nightwatch-cucumber trace fixture over the same flow. Cucumber exposes
  per-scenario hooks, so each scenario below is captured as its own test unit.

  Scenario: logs in with valid credentials and lands on /secure
    Given I am on the login page
    When I enter username "tomsmith" and password "SuperSecretPassword!"
    And I submit the login form
    Then I should be on the secure page
    And I should see a flash message matching "You logged into a secure area"

  Scenario: rejects invalid username with an error flash
    Given I am on the login page
    When I enter username "foobar" and password "barfoo"
    And I submit the login form
    Then I should see a flash message matching "Your username is invalid"
    And I should still be on the login page
