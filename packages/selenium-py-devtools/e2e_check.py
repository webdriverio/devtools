#!/usr/bin/env python3
"""End-to-end smoke: real headless Chrome → adapter → backend.

Run against a running backend (set DEVTOOLS_PORT if not 3000):
    DEVTOOLS_PORT=63763 PYTHONPATH=src python3 e2e_check.py

Uses a data: URL so it needs no network.
"""

import sys
import time

import wdio_selenium_devtools as devtools

PAGE = "data:text/html,<h1>Hello DevTools</h1><a href='%23x'>link</a>"


def main() -> int:
    capturer = devtools.enable()
    if capturer is None:
        print("backend not reachable — start it first")
        return 1

    from selenium import webdriver
    from selenium.webdriver.chrome.options import Options
    from selenium.webdriver.common.by import By

    opts = Options()
    opts.add_argument("--headless=new")
    opts.add_argument("--no-sandbox")
    driver = webdriver.Chrome(options=opts)
    try:
        driver.get(PAGE)
        heading = driver.find_element(By.CSS_SELECTOR, "h1")
        print("h1 text:", heading.text)
        driver.find_element(By.CSS_SELECTOR, "a").click()
        print("title:", driver.execute_script("return document.title"))
    finally:
        driver.quit()
        time.sleep(1)  # let frames flush
        devtools.disable()
    print("done")
    return 0


if __name__ == "__main__":
    sys.exit(main())
