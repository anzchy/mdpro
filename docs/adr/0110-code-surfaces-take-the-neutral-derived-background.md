# 0110. Code surfaces take the neutral derived background

**Status**: Accepted (2026-10-16, user decision at STOP 3, question S2: 「Review formula」, relayed by mdpro-delegator from its AskUserQuestion; proposed the same day by mdpro-a3).

## Context

`--color-code-bg` fills inline code and code blocks in WYSIWYG (`MilkdownEditor.css`). It was a literal in each theme: `#f4f4f4` light and `#1b2230` dark. The dark value carries a clear cool blue cast, which matched decision D4 in `docs/design/mdpro-ui-new/DESIGN.md`: keep the current cool neutrals and derive only the mechanics.

The Codex design review's item 15 proposed deriving the token from the editor background and the text colour, as WI-3.1 had already done for borders, hover and shadow. WI-3.2's ruling (c) deferred it as an optional P2 item, and `tests/design-tokens-retune.test.ts` pinned the literals. The Stage 3 sign-off (STOP 3) put the question to the user as S2, with a prototype on `prototype/stop3-s1-marker-chips` (`e5567957`). The prototype showed both themes side by side on the real stylesheets.

The forces as understood at the time:

- D4 asks for the cool cast. Only the dark literal shows it clearly.
- Every other surface token is now a `color-mix()` of the theme's own colours, so one rebrand of the base tokens moves them all. The two code-bg literals were the last surface colours outside that scheme.
- Contrast is not the deciding force. Code text measured 12.9–15.8:1 on every option.

## Options considered

| Option | Light | Dark | Why it lost, or won |
|---|---|---|---|
| **Keep the literals** (recommended to the user) | `#f4f4f4` | `#1b2230`, cool | Lost. The user chose the derived fill. It kept D4's cast, but left two hand-picked literals outside the derived scheme. |
| **Review formula**: `color-mix(in srgb, var(--color-editor-bg) 94%, var(--color-text))` | `#f1f1f1` | `#1c1e22`, neutral | **Chosen.** One formula in both themes that follows the base tokens; it drops the cool cast. |
| Editor background 92% with `--color-muted` | `#f3f4f5` | `#1a1d22`, slightly cool | Lost. A compromise that keeps a trace of the cast through the muted grey, at the cost of a second base token in the mix and a cast too faint to read as intended. |

## Decision

`--color-code-bg` is `color-mix(in srgb, var(--color-editor-bg) 94%, var(--color-text))` in `.theme-light`, in `.theme-dark`, and in the `:root` light copy. It resolves to `#f1f1f1` light and `#1c1e22` dark.

Code surfaces are neutral in both themes. D4 still governs the base neutrals (`--color-bg`, `--color-surface`, `--color-panel`, `--color-text`, `--color-muted`); this decision narrows it only for the code fill.

## Consequences

- **Gives up D4's cool cast on code.** In dark, code blocks and inline code turn from a blue-grey to a neutral grey, so they no longer echo the accent. Someone reading DESIGN.md's D4 entry alone would expect the cast. The § Tokens row now links here, and rule 31 lists the token among the text mixes.
- **The code fill separates less in dark.** Against the editor background the fill drops from 1.19:1 to 1.13:1. In light it moves from 1.10:1 to 1.13:1. Code blocks still have their 8 px radius and padding to mark them, but the fill alone is a little quieter in dark.
- **Code text stays well readable:** 15.44:1 light and 13.51:1 dark on the new fill (rule 31's 4.5:1 floor; `tests/design-tokens-retune.test.ts` asserts ≥ 4.5 and the resolved values).
- **One fewer literal**: a change to `--color-editor-bg` or `--color-text` now moves the code fill with it, in both themes.
- **Forecloses the muted-mix variant** unless a later ADR supersedes this one. Bringing back a cool cast now means a new decision, not a token tweak.
- No device change outside the two WYSIWYG code surfaces. Source mode and HTML export don't read this token.
