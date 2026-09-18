---
"@wdio/devtools-service": patch
---

Record a passing `.not.*` assertion as passed. Every negated matcher that succeeded was rendered as a failed action row and collected into the Errors tab, inside a test the runner itself reported green — so a clean run showed a red row and an error it had not produced.

expect-webdriverio hands `afterAssertion` the **raw** matcher result: jest's convention is that `pass` answers the *positive* assertion and the framework inverts it for `.not`, so a passing `.not.toBeDisplayed()` arrives as `pass: false`. Nothing in the hook's parameters carries `isNot` — it lives on the matcher's own `this` — which leaves the formatted message as the only carrier that reaches an adapter.

Both signals are read off the generated **diff block**, never the prose. The first line is `Expect ${subject} ${not}to …` and a subject is user-controlled, so scanning it let a selector or an expected value containing "not to" reverse a positive assertion's outcome. A matcher that takes a value labels the diff `Expected [not]` when negated; the `.be` family renders no such label (`enhanceErrorBe` passes `useNotInLabel: false`) and encodes the negation in the generated expected value instead, which is trusted only when the user supplied none — `toHaveText('not foo')` prints the same shape.

A caller that already knows the outcome, such as the synthesized row for a matcher that hard-threw, skips the inversion entirely rather than having a decided failure re-read from its message.

Not mobile-specific: this affected every `.not.*` matcher on every run.
