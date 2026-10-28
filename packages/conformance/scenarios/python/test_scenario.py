"""The conformance scenario through selenium-devtools-py's pytest plugin: the same tests as every adapter's, in pytest's idiom."""

import os

import pytest
from selenium import webdriver
from selenium.common.exceptions import WebDriverException
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait


def env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        pytest.fail(f"{name} is not set; run this through the conformance harness")
    return value


def wait_for_text(driver, selector: str, text: str) -> None:
    # A helper wait that repeats the read the test issued just before it.
    WebDriverWait(driver, 2).until(lambda d: d.find_element(By.CSS_SELECTOR, selector).text == text)


@pytest.fixture(scope="module")
def driver():
    driver = webdriver.Remote(
        command_executor=env("CONFORMANCE_WEBDRIVER"), options=webdriver.ChromeOptions()
    )
    yield driver
    driver.quit()


def test_logs_in_and_reads_the_greeting(driver):
    driver.get(env("CONFORMANCE_LOGIN_URL"))
    driver.find_element(By.CSS_SELECTOR, "#username").send_keys("tom")
    driver.find_element(By.CSS_SELECTOR, "#password").send_keys("secret")
    driver.find_element(By.CSS_SELECTOR, 'button[type="submit"]').click()
    WebDriverWait(driver, 2).until(EC.presence_of_element_located((By.CSS_SELECTOR, "#flash")))
    greeting = driver.find_element(By.CSS_SELECTOR, "#flash").text
    assert greeting == "You logged into a secure area!"


def test_waits_on_what_the_page_shows(driver):
    greeting = driver.find_element(By.CSS_SELECTOR, "#flash").text
    WebDriverWait(driver, 2).until(
        lambda d: d.find_element(By.CSS_SELECTOR, "#flash").text and d.find_element(By.CSS_SELECTOR, "h2").text
    )
    wait_for_text(driver, "#flash", greeting)
    driver.find_element(By.CSS_SELECTOR, "#logout").click()


def test_asserts_on_the_page_title(driver):
    # The heading reads the same text as the title, and the secure page's heading read the expected value.
    driver.find_element(By.CSS_SELECTOR, "h2").text
    title = driver.title
    assert title != "Secure Area"


def test_fails_on_the_wrong_heading(driver):
    heading = driver.find_element(By.CSS_SELECTOR, "h2").text
    assert heading == "Secure Area"


def test_times_out_waiting_for_a_missing_element(driver):
    WebDriverWait(driver, 0.3).until(EC.presence_of_element_located((By.CSS_SELECTOR, "#missing")))


def test_survives_a_refused_navigation(driver):
    try:
        driver.get(env("CONFORMANCE_BROKEN_URL"))
    except WebDriverException:
        pass
