# D256 / D257 verdict

User, 2026-10-17 (AskUserQuestion, relayed by mdpro-delegator):

- **D256** (highlighted text): 「B · fainter dark pink (Recommended)」. A theme-split
  `--color-highlight`: light keeps today's pink (alpha 0.65), dark drops it to alpha 0.40,
  and the marked text takes `--color-text` (today it is the UA black). Measured 8.19:1 light, 8.02:1 dark.
- **D257** (Settings error box): 「B1 · darker red, dark unchanged (Recommended)」. A new
  `--color-danger-text`: light #b91c1c, dark #f87171 (today's dark look). Measured 5.37:1
  light, 4.92:1 dark.

Implemented on `fix/d256-d257-contrast` (D256-WI-*, D257-WI-*). This branch never lands.
