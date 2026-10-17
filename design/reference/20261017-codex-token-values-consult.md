# Codex consult: should mdpro's design docs show token values?

Asked 2026-10-17 by mdpro-10 via cc-suite (`gpt-6.1-sol`, effort high, read-only), thread `01a1483e-4882-7970-b3c1-f4156227fa8e`.

## The question as sent

Repo: mdpro (Tauri 2 + React macOS Markdown editor).

## Forces

- `.claude/rules/31-design-tokens.md:11-19`: tokens live only in `src/styles/globals.css`, `themes/light.css` and `themes/dark.css`. "For the actual token values, read those files. Don't mirror them here — the doc would silently rot."
- `design/DESIGN.md` (~900 lines) is the design reference all UI work cites. Its § Tokens table names each token with role, scope and ruling, but no values. For tokens added before 2026-09-11, values sit in the frozen `design/archive/20260911-proposal-ab.html:21-61`. For later tokens (D222 `--color-accent-text`, `--color-accent-fill*`; D227 `--color-control-border`; D231 `--color-tab-active-fill`), values exist only in CSS.
- Many derived tokens are `color-mix()` formulas, so a "value" is a formula, not a hex.
- Precedent for generated-and-checked docs: `docs/feature-ledger.md` + `pnpm ledger:check` (a CI gate checks path claims and surface coverage) + `pnpm ledger:build` (renders HTML).
- Existing tests already read DESIGN.md: `tests/design-tokens-redesign.test.ts` asserts each redesign token has a `| \`--name\` |` row in the § Tokens slice; `tests/contrast-stage3.test.ts` checks § Tokens names D189 tokens; `tests/contrast-*.test.ts` compute WCAG contrast from the CSS.
- Readers: mostly Claude/Codex agent sessions, plus the user choosing between visual options. The user wants design materials that are organised "like a pro".
- Process cost: a script + check is tooling (tests under tests/tooling/, tdd-guardian receipts, two pre-landing audits, CI). An ADR is needed to amend rule 31.

## Options

A. Keep rule 31. No values in docs. DESIGN.md names tokens. Readers open the three CSS files.
B. Generated values page. A script parses the three CSS files and writes `design/tokens.md`: name, light, dark, resolved hex for color-mix where computable, the role pulled from DESIGN.md § Tokens. A check fails CI when the page is stale. Rule 31 is amended: "never hand-copy values; the generated page is the one allowed mirror".
C. No doc page. Add values to an existing artifact instead: e.g. a rendered token specimen HTML (swatches in both themes) generated from the CSS, not committed, built on demand.
D. Something else you think is better.

## Ask

Which option, and why? Name the failure modes of your pick, especially rot, churn on every CSS commit, color-mix resolution, and whether it duplicates what the contrast tests already prove. Keep the answer under 400 words.

## Codex's answer

**Pick D: a smaller B—generate a committed Markdown reference containing authored CSS expressions, without resolved hex values.** Include defaults, light/dark overrides, source locations, and links to token rationale. This serves agent readers better than an uncommitted visual specimen.

The premise needs correction: DESIGN.md already contains D222/D227 formulas and literal values; those values do **not** exist only in CSS. Its token tables also mix implemented and proposed tokens.

| Severity | Finding | Location | Recommendation |
|---|---|---|---|
| MUST | **Internal consistency:** “no values” contradicts existing value-bearing rows; the introduction still directs readers to the proposal. | [DESIGN.md:18](../../design/DESIGN.md), [109](../../design/DESIGN.md) | Establish CSS as implementation authority; retain historical values only as clearly labeled decision context. |
| MUST | **Completeness:** D231 has no token rows. Six documented tokens lack declarations in the three CSS inputs. Existing documentation assertions cover selected lists, not the inventory. | [CSS:22](../../src/styles/globals.css), [token tests:28](../../tests/design-tokens-redesign.test.ts) | Inventory from CSS; label proposed-only and undocumented entries explicitly. |
| MUST | **Feasibility:** the contrast resolver supports a narrow grammar, not arbitrary CSS. Translucent colors lack a unique opaque rendered hex. | [resolver:10](../../tests/support/contrast.ts) | Preserve expressions; defer computed colors to optional browser specimens with named backdrops. |
| MUST | **Ambiguity:** theme values could mean declarations or effective inherited values; media and runtime overrides are unspecified. | [globals.css:89](../../src/styles/globals.css), [115](../../src/styles/globals.css) | Define both columns and explicitly scope conditional/runtime values. |
| MUST | **Risk and sequencing:** design-only changes skip frontend tests. Ledger CI validates Markdown, not generated-HTML freshness. | [scope:24](../../scripts/ci/change-scope.mjs), [ledger:81](../../scripts/ledger/check.mjs) | Amend rule 31, define generation semantics, then add an unconditional freshness check. |

Failure modes remain: manual edits rot; missing metadata silently drops tokens; unstable ordering, timestamps, or formatting cause churn. Generate deterministically from normalized declarations so unrelated CSS changes produce no diff. Fail on missing output and unsupported structural changes.

This complements contrast tests: they measure selected foreground/background pairs and pin accepted exceptions; they do not prove documentation freshness, inventory completeness, or browser rendering ([contrast-stage3:148](../../tests/contrast-stage3.test.ts)).

Verification was read-only source inspection plus an inventory/CI-classification probe; no test-suite execution.

**Overall Verdict: NEEDS REVISION**

**Top 3 Risks:** misleading color resolution; incomplete implemented/proposed inventory; freshness checks bypassed by docs-only CI.
