"""Whether a session's capabilities describe a device, and a document.

Mirrors the native-session predicate in ``packages/shared/src/device.ts`` — the
device's name and version are read on the TS side, from the capabilities this
adapter sends. The platform list comes from the generated contract rather than
being retyped here, so shared stays the one place it is stated.
"""

from __future__ import annotations

from typing import Any, Dict, Optional

from ._contract import NATIVE_PLATFORMS


def _cap_string(caps: Dict[str, Any], key: str) -> Optional[str]:
    value = caps.get(key)
    if isinstance(value, str) and value.strip():
        return value
    return None


def _deep_cap_string(caps: Dict[str, Any], key: str) -> Optional[str]:
    """The capability from the bag, or from one level of vendor options. A
    device cloud commonly states ``platformName`` and ``browserName`` only
    inside its own bag (``bstack:options``).

    Every caller passes MATCHED capabilities, so a request-shaped bag's
    ``firstMatch`` list is deliberately not scanned — the server merges
    ``alwaysMatch`` with the one entry it chose, and reading a browser out of
    any entry would claim one the session never got."""
    own = _cap_string(caps, key)
    if own:
        return own
    for nested in caps.values():
        if isinstance(nested, dict):
            value = _cap_string(nested, key)
            if value:
                return value
    return None


def _names_an_automation(caps: Dict[str, Any]) -> bool:
    """Whether the capabilities name an Appium automation. Separate from naming
    a DEVICE: a Mac2, WinAppDriver or tvOS session has no document either."""
    return bool(
        _deep_cap_string(caps, "appium:automationName")
        or _deep_cap_string(caps, "automationName")
    )


def native_platform(capabilities: Any) -> Optional[str]:
    """``'android'``/``'ios'`` when the session ran on a device, else None."""
    if not isinstance(capabilities, dict):
        return None
    platform = _deep_cap_string(capabilities, "platformName")
    if platform is None:
        return None
    lowered = platform.lower()
    return lowered if lowered in NATIVE_PLATFORMS else None


def is_native_app_session(capabilities: Any) -> bool:
    """Whether the session had no web document to run page script in.

    A device alone does not answer it: an Appium session driving Chrome or
    Safari runs on a phone and has a real page, so the browser it names is the
    discriminator. A device is not required either — an Appium automation is
    enough, because a Mac2 or tvOS session has no document. See shared's
    `isNativeAppSession` for why answering False is the expensive direction.
    """
    if not isinstance(capabilities, dict):
        return False
    if native_platform(capabilities) is None and not _names_an_automation(
        capabilities
    ):
        return False
    return _deep_cap_string(capabilities, "browserName") is None


def driver_is_native_app(driver: Any) -> bool:
    """`is_native_app_session` for a live driver, whose capabilities selenium
    exposes as a plain dict."""
    return is_native_app_session(getattr(driver, "capabilities", None))
