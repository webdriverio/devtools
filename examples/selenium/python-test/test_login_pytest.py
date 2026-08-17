"""The same login flow as ``login.py``, but under pytest — which is how most
Python suites are actually written, and the only style that gives the dashboard
a real test tree.

It deliberately mixes both shapes pytest supports, because they nest differently:

    test_login_pytest.py
    └── TestLogin              ← a class groups its tests
        ├── test_logs_in_with_valid_credentials
        └── test_rejects_invalid_credentials
    └── test_the_login_page_loads   ← a module-level test has no class

pytest has no ``describe``/``it`` blocks; a class IS the grouping construct, so
this is the closest equivalent to a nested ``describe`` in the JS examples.

Run it (the plugin is inert unless a devtools env var opts the run in):

    pip install -e packages/selenium-devtools-py
    DEVTOOLS_ENABLE=1 python -m pytest examples/selenium/python-test/test_login_pytest.py

The driver fixture is function-scoped, so each test gets its own browser session
— which also exercises the adapter's per-driver capture state.
"""

import pytest
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait

BASE_URL = "https://the-internet.herokuapp.com"
USERNAME = "tomsmith"
PASSWORD = "SuperSecretPassword!"
TIMEOUT = 5


@pytest.fixture
def driver():
    options = Options()
    options.add_argument("--headless=new")  # drop this line to watch the browser
    options.add_argument("--window-size=1280,1024")
    # Chrome's password-leak check recognises this demo credential and then stops
    # delivering ALL synthesized input to the tab — mouse and keyboard alike —
    # about a second after the submit. chromedriver still answers 200, so the
    # logout click would silently do nothing. Pointing the check at localhost is
    # what keeps a login and a logout working in the same session.
    options.add_argument(
        "--host-resolver-rules=MAP passwordsleakcheck-pa.googleapis.com 127.0.0.1"
    )
    drv = webdriver.Chrome(options=options)
    yield drv
    drv.quit()


def _login(driver, username, password):
    wait = WebDriverWait(driver, TIMEOUT)
    driver.get(f"{BASE_URL}/login")
    wait.until(EC.visibility_of_element_located((By.ID, "username")))
    driver.find_element(By.ID, "username").send_keys(username)
    driver.find_element(By.ID, "password").send_keys(password)
    driver.find_element(By.CSS_SELECTOR, 'button[type="submit"]').click()
    wait.until(EC.visibility_of_element_located((By.ID, "flash")))
    return driver.find_element(By.ID, "flash").text


class TestLogin:
    """Grouped tests — this class should read as its own node in the tree."""

    def test_logs_in_with_valid_credentials(self, driver):
        flash = _login(driver, USERNAME, PASSWORD)
        assert "/secure" in driver.current_url, driver.current_url
        assert "You logged into a secure area" in flash, flash

        WebDriverWait(driver, TIMEOUT).until(
            EC.visibility_of_element_located((By.CSS_SELECTOR, "a.button"))
        )
        driver.find_element(By.CSS_SELECTOR, "a.button").click()
        WebDriverWait(driver, TIMEOUT).until(
            EC.visibility_of_element_located((By.ID, "username"))
        )
        assert "/login" in driver.current_url, driver.current_url

    def test_rejects_invalid_credentials(self, driver):
        flash = _login(driver, USERNAME, "wrong-password")
        assert "/login" in driver.current_url, driver.current_url
        assert "Your password is invalid" in flash, flash


def test_the_login_page_loads(driver):
    """Module-level, no class — the flat shape, for contrast with the group."""
    driver.get(f"{BASE_URL}/login")
    WebDriverWait(driver, TIMEOUT).until(
        EC.visibility_of_element_located((By.ID, "login"))
    )
    assert driver.title == "The Internet", driver.title
