"""The smallest useful DevTools example: three devtools lines, one Selenium test.

This is the script reproduced in the integration one-pager, so keep the two in
sync when either changes.

Run it against a dashboard backend that is already listening:

    node -e "import('./packages/backend/dist/index.js').then(m => m.start())"   # one terminal
    DEVTOOLS_PORT=3000 python examples/selenium/python-test/web_form_minimal.py

Letting ``enable()`` launch the backend itself does not work yet: the backend
ships no runnable entry, so ``node packages/backend/dist/index.js`` exits without
serving. ``web_form.py`` next door is the fuller variant (headless, sized
viewport, explicit teardown).
"""

import devtools_selenium as devtools
from selenium import webdriver
from selenium.webdriver.common.by import By

devtools.enable()  # opens the dashboard, starts capturing

driver = webdriver.Chrome()
try:
    driver.get("https://www.selenium.dev/selenium/web/web-form.html")
    driver.find_element(By.NAME, "my-text").send_keys("Selenium")
    driver.find_element(By.CSS_SELECTOR, "button").click()
    print(driver.find_element(By.ID, "message").text)
finally:
    driver.quit()
    devtools.wait_for_dashboard_close()  # hold the UI open to inspect
