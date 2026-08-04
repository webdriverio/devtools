"""pytest smoke that exercises the plugin (suites) + instrumentation (commands).

Run against a running backend:
    DEVTOOLS_PORT=63763 PYTHONPATH=src \
      pytest e2e/test_smoke.py -p wdio_selenium_devtools.pytest_plugin -q

Uses a data: URL so it needs no network.
"""

import pytest
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By

PAGE = "data:text/html,<h1>Hello DevTools</h1><a href='%23x'>link</a>"


@pytest.fixture
def driver():
    opts = Options()
    opts.add_argument("--headless=new")
    opts.add_argument("--no-sandbox")
    drv = webdriver.Chrome(options=opts)
    yield drv
    drv.quit()


def test_homepage_loads(driver):
    driver.get(PAGE)
    assert "Hello DevTools" in driver.find_element(By.CSS_SELECTOR, "h1").text


def test_link_is_clickable(driver):
    driver.get(PAGE)
    driver.find_element(By.CSS_SELECTOR, "a").click()
