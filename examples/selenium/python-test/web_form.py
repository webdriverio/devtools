"""A normal Selenium (Python) test — with WebdriverIO DevTools added.

Only two lines differ from a plain Selenium script (marked ← devtools):
``import wdio_selenium_devtools`` and ``devtools.enable()``. Everything the
driver does is then captured and shown live in the DevTools dashboard.

Run it:

    pip install wdio-selenium-devtools selenium
    python examples/selenium/python-test/web_form.py

The dashboard opens in a dedicated window and captures every command. It stays
open after the test so you can inspect it — close the window (or Ctrl-C) to
finish. The screencast .webm is written next to this file. Requires a
ChromeDriver matching your Chrome (Selenium 4.6+ auto-manages one if none is on
PATH).
"""

import wdio_selenium_devtools as devtools  # ← devtools
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By

devtools.enable()  # ← devtools: open the dashboard + capture every command

options = Options()
options.add_argument("--headless=new")  # remove this line to watch the browser
options.add_argument("--window-size=1280,1024")  # bigger viewport → fuller screencast
driver = webdriver.Chrome(options=options)
try:
    driver.get("https://www.selenium.dev/selenium/web/web-form.html")

    title = driver.title

    driver.implicitly_wait(0.5)

    text_box = driver.find_element(by=By.NAME, value="my-text")
    submit_button = driver.find_element(by=By.CSS_SELECTOR, value="button")

    text_box.send_keys("Selenium")
    submit_button.click()

    message = driver.find_element(by=By.ID, value="message")
    text = message.text
    print("form submitted, received message:", text)  # shows in the dashboard's Console
finally:
    driver.quit()
    devtools.wait_for_dashboard_close()  # ← devtools: keep the UI open to inspect
    devtools.disable()  # ← devtools
