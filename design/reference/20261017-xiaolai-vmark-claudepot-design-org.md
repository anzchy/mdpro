# How xiaolai's vmark and claudepot-app organise their design material

Read on 2026-10-17 through `gh api`, at the default branch's HEAD of
[`xiaolai/vmark`](https://github.com/xiaolai/vmark) and
[`xiaolai/claudepot-app`](https://github.com/xiaolai/claudepot-app). I also
ran vmark's `scripts/check-design-tokens.mjs` against mdpro's 27 CSS files
in fixture mode, which uses no baseline.

## The short answer

Neither repo has a design folder, a `DESIGN.md`, mockups or prototype pages.
Visual design lives in three places: agent rules, token code, and CI checks.
Both are single-maintainer projects, where a rule file is enough. mdpro has
several sessions and decides UI questions on prototypes, so it keeps that
evidence in [`design/`](../README.md).

## vmark (a Markdown editor)

| Where | What |
|---|---|
| `.claude/rules/30-35` | The design spec: UI consistency, tokens, components, focus, dark theme, copy. mdpro's rules 30–34 come from here |
| `src/theme/themes/<id>.ts`, `src/theme/tokens.ts` | The token source: six themes as typed `ThemeTokens` data, written to CSS variables at run time (ADR-014) |
| `.claude/adr/` | Design decisions, e.g. ADR-014 "theme tokens as typed data" |
| `scripts/check-design-tokens.mjs`, `scripts/design-tokens-baseline.json` | The gate, part of `pnpm check:all`. C2a: hex outside the palette files is an error. C2b: `rgb()`/`hsl()` against an identity baseline. C2c: a duplicate declaration. C2d: an `animation-name` with no `@keyframes`. C2e: a fallback for an undefined token. **C2f: rule 31's table rows against the declared tokens, plus tokens nobody consumes**, with reasoned `token-doc-ok` / `token-unused-ok` markers. C2g: literals in `className` strings. The baseline only ratchets down, and a baselined entry that now passes is also an error |
| `scripts/check-theme-contrast.ts`, `scripts/theme-contrast-baseline.json` | Contrast per theme, with its own baseline |
| `.claude/skills/css-design-tdd` | Run the checks before (RED) and after (GREEN) a CSS change |
| `website/` | User docs (VitePress, 10 languages), not design |

Two things mdpro does differently:

- **vmark's rule 31 table carries light default values** (`#eeeded`, …).
  C2f compares token **names**, so a value in that table can go stale.
  mdpro's rule 31 forbids mirroring values for exactly that reason.
- **vmark's working docs left git.** `dev-docs/` (audits, plans, decisions)
  is maintainer-local since commit `abc253488`. ADR-014 opens with a note
  that it was restored from there. mdpro's sessions coordinate through
  committed docs, so this doesn't fit mdpro.

## claudepot-app

| Where | What |
|---|---|
| `.claude/rules/design.md` | The whole visual spec in one file: register (one monospace face, warm OKLCH, one terracotta accent, hairlines, flat rows), tokens, stylesheet layout, icons (Lucide only, with a narrow brand-mark exception), primitives |
| `src/styles/tokens.css` | The only file allowed to open `:root {}`. A literal anywhere else is a review finding |
| `.claude/commands/design-review.md` | Reviews a UI diff against the rule: BLOCK and WARN lists, then **"Needs a screenshot"**: traffic-light alignment, one primary action, the selected item clear in under a second, dark-mode parity. "If any 'needs a screenshot' check is load-bearing for this review and none is provided, stop and ask." |
| `panel/src/vendor/ds-tokens.css` | A second surface's tokens, same rule: every physical value is declared there and nowhere else |
| `web/design/` | **Product** design, not visual: `IA.md` (460 lines, versions v2–v4 stacked, each with a dated status note), `features.md`, `architecture.md`, fixtures, scripts |
| `web/src/components/prototype/` | The prototype's components became the shipped code |

## How mdpro's CSS measures against vmark's checker

On master `9c9bc92e`, vmark's checker found **0** undefined variables,
duplicate declarations, missing keyframes or undefined fallbacks. It found
85 colour, radius and focus findings. 57 are in mdpro's three token files,
which vmark excludes for its own `index.css`. The other 28 break down as:

- **Dead code: 20.**
  - `src/App.css`, the Tauri template from the first commit, which nothing
    imports: 15 hex and 1 rgba.
  - `tab-bar.css` (1) and the orphan `.settings-search`,
    `.settings-placeholder-card` and `.settings-form-row` (3 radii).
- **Scheduled: 6.** The MCP badge green and the toggle `#ccc` (WI-4.4
  item 6), the amber dirty banner (WI-4.3), and the badge's 12px radius.
- **False positives: 2.** Two `:focus` rules draw a border-and-shadow ring
  (rule 33 pattern 1). vmark only accepts `:focus-visible` or a marker
  comment.

mdpro's own gate, `tests/css-tokenization.test.ts`, is wider than vmark's.
It covers sizes, z-index and motion as well as colour, and it names every
allowed literal: 4 EXCEPTIONS, 15 DEFERRED with their WI, and the
UNRENDERED dead code. Only two literals sat in no list: the `#007aff`
fallback in `settings-about.css:91`, and `--color-danger-soft` mixing hex
instead of `var(--color-danger)`. Both are now D275.

## What mdpro takes from this

| Practice | Source | Where it went in mdpro |
|---|---|---|
| A design review that won't pass render-time checks without a screenshot | claudepot `/design-review` | [`/mdpro-design-review`](../../.claude/commands/mdpro-design-review.md) |
| Docs ⇄ declared tokens in both directions, plus tokens nobody consumes, with reasoned markers | vmark C2f | D278 |
| Hex outside the token files is an error, with no deferral | vmark C2a | D278. The user chose 「Strict now, like vmark」, so the three deferred hex rows go once WI-4.4 picks their colours on a prototype |
| A dated status note at the top of a long design doc | claudepot `IA.md` | Not yet adopted; candidate for `design/DESIGN.md` |

Not taken: token values in a rule table (vmark), and design docs kept out of
git (vmark).
