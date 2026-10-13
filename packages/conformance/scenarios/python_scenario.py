"""The conformance scenario, driven through selenium-devtools-py.

Run by the conformance harness, which points ``enable()`` at its recording
backend through the reuse handshake and Selenium at its fake WebDriver.
"""

import os

from selenium import webdriver
from selenium.common.exceptions import WebDriverException
from selenium.webdriver.common.by import By

import selenium_devtools


def env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise SystemExit(f"{name} is not set; run this through the conformance harness")
    return value


selenium_devtools.enable()
driver = webdriver.Remote(command_executor=env("CONFORMANCE_WEBDRIVER"), options=webdriver.ChromeOptions())
try:
    driver.get(env("CONFORMANCE_LOGIN_URL"))
    driver.find_element(By.CSS_SELECTOR, "#username").send_keys("tom")
    driver.find_element(By.CSS_SELECTOR, "#password").send_keys("secret")
    driver.find_element(By.CSS_SELECTOR, 'button[type="submit"]').click()
    driver.find_element(By.CSS_SELECTOR, "#logout").click()
    try:
        driver.get(env("CONFORMANCE_BROKEN_URL"))
    except WebDriverException:
        pass
finally:
    driver.quit()
    selenium_devtools.disable()
