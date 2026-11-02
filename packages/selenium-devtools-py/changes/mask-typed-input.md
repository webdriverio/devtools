---
minor
---

Typed text is masked by default. A `send_keys` row (and a prompt's, and `ActionChains` key presses) carries `••••` instead of the text, the recorded DOM masks the value of text inputs and textareas and the text of editable regions, and a typed value that resurfaces in a value read, an assertion, a log line or a request body the page sent is replaced too. `enable(mask_selectors=[...])`, `--devtools-mask-selector` or `DEVTOOLS_MASK_SELECTORS` masks the text and value of more elements; `enable(mask_inputs=False)`, `--devtools-no-mask-inputs` or `DEVTOOLS_MASK_INPUTS=0` restores full capture. Screenshots and screencast frames are not masked.
