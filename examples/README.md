# Examples

Demo projects used to verify capture by hand. Type-checks and unit tests verify
code correctness; these verify that a feature actually works, which is what a UI
or runtime change has to be judged on.

One directory per adapter, and inside it one per test runner, named for the
runner. A runner directory holds its own config and its specs — `features/`
inside a Cucumber directory is Cucumber's convention, not ours.

```
examples/
├── wdio/          mocha/  cucumber/  mobile/  pageobjects/
├── nightwatch/    bdd/    cucumber/  mobile/
├── selenium-js/   mocha/  jest/  cucumber/  mobile/
└── selenium-py/   scripts/  pytest/
```

## Running them

Every example drives the same login flow against the same site, so a trace from
one is comparable with a trace from another.

| Command                      | What it runs                                                     |
| ---------------------------- | ---------------------------------------------------------------- |
| `pnpm demo:wdio`             | WebdriverIO + Cucumber                                           |
| `pnpm demo:wdio:mocha`       | WebdriverIO + Mocha                                              |
| `pnpm demo:wdio:retry`       | WebdriverIO + Mocha, with a flaky test for retry-aware retention |
| `pnpm demo:nightwatch`       | Nightwatch, BDD interface                                        |
| `pnpm demo:nightwatch:retry` | The same, with `--retries 1`                                     |
| `pnpm demo:selenium`         | Selenium + Cucumber                                              |
| `pnpm demo:wdio:retention`   | WebdriverIO + Cucumber, a passing and a failing spec under a retention policy |
| `pnpm demo:python`           | Python, plain script                                             |
| `pnpm demo:python:login`     | Python, plain script (login flow)                                |
| `pnpm demo:python:pytest`    | Python + pytest                                                  |
| `pnpm demo:wdio:mobile`      | WebdriverIO against Appium                                       |
| `pnpm demo:nightwatch:mobile` | Nightwatch against Appium                                       |
| `pnpm demo:selenium:mobile`  | Selenium against Appium                                          |
| `pnpm demo:python:mobile`    | Python against Appium                                            |

`pnpm --filter @wdio/selenium-devtools example:<runner>` runs one Selenium
runner directly — `example:mocha`, `example:jest`, `example:cucumber`, or
`example:mocha:allure` for the Allure variant.

`DEVTOOLS_MODE=trace` flips a demo to trace mode; the default is live.
`DEVTOOLS_TRACE_GRANULARITY` and `DEVTOOLS_TRACE_POLICY` walk the rest of the
ladder, so each runner needs only one config.

## Mobile

Every adapter has a `mobile/` example, and all four build the same capability
bag, so a difference in the dashboard between two of them is a difference in the
adapter rather than in the test. They drive the **Clock app**, which ships with every Android system image, so
they run without an `.apk` or credentials;
`APPIUM_APP` points one at a real app, and `DEVTOOLS_MOBILE=web` drives the
device's own browser instead — Chrome on Android, Safari on iOS. Worth running
too, because a mobile browser session has a document and must keep every
page-side call a native one skips.

Each checks the toolchain before opening a session, through the shared
[`mobile-preflight.cjs`](./mobile-preflight.cjs), because none of the four
frameworks reports a missing Appium in a way that names the cause.

`DEVTOOLS_MOBILE_PLATFORM=ios` runs the iOS spec instead, in every adapter. iOS
drives **Settings**, because the simulator ships no Clock app at all, and lives
in its own spec rather than a branch: the two platforms share no selectors.

```
examples/wdio/mobile/specs/android|ios/
examples/nightwatch/mobile/android|ios/
examples/selenium-js/mobile/android|ios/
examples/selenium-py/mobile/android|ios/
```

The simulator is chosen by **udid**, defaulting to whichever is already booted.
Naming one that does not exist does not fail — the XCUITest driver creates and
boots it, every run — so `IOS_DEVICE_NAME` only picks among booted devices, an
unmatched name is refused rather than passed through, and `IOS_UDID` names one
outright.

[MOBILE.md](./MOBILE.md) has the prerequisites and the switches.

## Per-adapter notes

**`wdio/`** — `mocha/` carries the spec variants (`specs/`, and `retry/` for the
flaky test), each with its own `wdio.*.conf.ts`. `cucumber/` carries the feature
files. `pageobjects/` is shared by both, which is why it sits beside them rather
than inside either.

**`nightwatch/`** — `bdd/` uses Nightwatch's `describe/it` interface, `cucumber/`
its Cucumber runner. The two interfaces capture differently: Cucumber exposes
per-scenario hooks, BDD `describe/it` does not, so per-test trace slicing
degrades to session scope there.

**`selenium-js/`** — one directory per JS runner. The adapter is required via
`--require @wdio/selenium-devtools`, so each runner's own config is all that
differs.

**`selenium-py/`** — `scripts/` holds the plain-script cases, which have no test
runner at all and produce a single synthetic suite; `pytest/` holds the pytest
case, where each test is a real node in the tree.

## Output

Runs write `test-results/` next to the example, and trace archives as
`trace-*.zip`. Both are ignored, and both are safe to delete — every one of them
is regenerated by the next run.
