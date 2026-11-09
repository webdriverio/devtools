---
minor
---

Password fields are masked in the replayed page by default: the recorded DOM replaces the value of every `<input type="password">` with `••••`, keystroke by keystroke, while the `send_keys` row keeps the real text. `enable(mask_selectors=[...])`, `--devtools-mask-selector` or `DEVTOOLS_MASK_SELECTORS` masks the text and value of more elements; `enable(mask_inputs=False)`, `--devtools-no-mask-inputs` or `DEVTOOLS_MASK_INPUTS=0` turns the password masking off. Command rows, screenshots, console lines and request bodies are not masked.
