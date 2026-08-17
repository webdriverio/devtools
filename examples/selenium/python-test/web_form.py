"""The smallest useful DevTools example: three devtools lines, one Selenium test.

This is the script reproduced in the integration one-pager, so keep the two in
sync when either changes.

Run it:

    pip install -e packages/selenium-devtools-py
    python examples/selenium/python-test/web_form.py

``enable()`` starts the dashboard backend itself when none is running. Set
DEVTOOLS_PORT instead to attach to one you already have open. Run output (the
screencast .webm) lands in ``test-results/`` beside this file, matching the JS
adapters.
"""

import selenium_devtools as devtools
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.options import Options

devtools.enable()  # opens the dashboard, starts capturing

options = Options()
options.add_argument("--headless=new")  # drop this line to watch the browser
options.add_argument("--window-size=1280,1024")  # bigger viewport, fuller screencast
driver = webdriver.Chrome(options=options)
try:
    driver.get("https://www.selenium.dev/selenium/web/web-form.html")
    driver.find_element(By.NAME, "my-text").send_keys("Selenium")
    driver.find_element(By.CSS_SELECTOR, "button").click()
    print(driver.find_element(By.ID, "message").text)
finally:
    driver.quit()
    devtools.wait_for_dashboard_close()  # hold the UI open to inspect
