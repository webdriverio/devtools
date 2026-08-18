"""Login and logout in one run — the Python twin of the Nightwatch/WDIO login
examples, so the same flow can be compared across all four adapters.

It exercises what the smaller ``web_form.py`` example does not: a form submit
that navigates, assertions against the destination, and a second navigation
back. That is the shape most capture bugs show up in, because every DOM anchor
has to land on the document the action actually ran against.

Run it:

    pip install -e packages/selenium-devtools-py
    python examples/selenium/python-test/login.py

``enable()`` starts the dashboard backend itself when none is running. Set
DEVTOOLS_PORT instead to attach to one you already have open. Run output (the
screencast .webm) lands in ``test-results/`` beside this file.
"""

import selenium_devtools as devtools
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait

BASE_URL = "https://the-internet.herokuapp.com"
USERNAME = "tomsmith"
PASSWORD = "SuperSecretPassword!"
TIMEOUT = 5

devtools.enable()  # opens the dashboard, starts capturing

options = Options()
options.add_argument("--headless=new")  # drop this line to watch the browser
options.add_argument("--window-size=1280,1024")

driver = webdriver.Chrome(options=options)
wait = WebDriverWait(driver, TIMEOUT)
try:
    print("[TEST] logging in with valid credentials")
    driver.get(f"{BASE_URL}/login")
    wait.until(EC.visibility_of_element_located((By.ID, "username")))
    driver.find_element(By.ID, "username").send_keys(USERNAME)
    driver.find_element(By.ID, "password").send_keys(PASSWORD)
    driver.find_element(By.CSS_SELECTOR, 'button[type="submit"]').click()

    # wait.until(EC.visibility_of_element_located((By.ID, "flash")))
    assert "/secure" in driver.current_url, driver.current_url
    flash = driver.find_element(By.ID, "flash").text
    assert "You logged into a secure area" in flash, flash

    # wait.until(EC.visibility_of_element_located((By.CSS_SELECTOR, "a.button")))
    driver.find_element(By.CSS_SELECTOR, "a.button").click()

    # wait.until(EC.visibility_of_element_located((By.ID, "username")))
    assert "/login" in driver.current_url, driver.current_url
    print("[TEST] logged back out")
finally:
    driver.quit()
    devtools.wait_for_dashboard_close()  # hold the UI open to inspect
