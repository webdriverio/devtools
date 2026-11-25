---
'@wdio/devtools-service': patch
'@wdio/selenium-devtools': patch
'@wdio/nightwatch-devtools': patch
'@wdio/devtools-backend': patch
---

A console line or network request sent while the adapter is still reading whether a typed field is a password is now held until that read settles (at most 2 s) and then sent with the password redacted. Before, a frame the typing itself set off could reach the live dashboard before the password was learned. A per-test archive rewritten at the end of the run now also redacts a stored body that is only a number, such as a numeric password.
