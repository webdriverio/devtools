Feature: Retention check — deliberately failing login

  # Logs in with bad credentials but asserts the SUCCESS message, so the Then
  # step fails. Used to verify retain-on-failure keeps this spec's trace while
  # dropping the passing login.feature. Reuses the existing step definitions.
  Scenario: Failing assertion exercises retain-on-failure
    Given I am on the login page
    When I login with foobar and barfoo
    Then I should see a flash message saying You logged into a secure area!
