# UI redesign plan — Stage 2

Part of [the UI redesign plan](../20260911-plan-ui-redesign.md), which holds the sources of truth, decisions, open questions, acceptance criteria and tasks.

## Stage 2 — Value-preserving tokenization (Deliverable A; zero visual change)

**Entry:** Stage 1 accepted (no stop between Stages 1 and 2).

### WI-2.1 — Tokenization guard test (RED first) — M
- Create `tests/css-tokenization.test.ts` with one `it` per in-scope CSS file. Use the source-inspection style of `tests/design-tokens-accent-danger.test.ts`, including its `@module` / `Purpose:` header.
- The test enforces the A5 definition: the property families in [`baseline-protocol.md`](baseline-protocol.md), the rule 31:58-76 allowlist, and the rule 31:83-91 z-index table plus any Q10 exception, and the dev-only toolbar rules (`.dev-toolbar*`, `globals.css:1509-1547`) as an exception with file:line (DR21). `999px` pill radii join `50%` on the allowlist, and WI-2.1 edits rule 31 § Acceptable hardcoded values in the same commit (DR23).
- **Deferred list (A12):**
  - Class (b) literals are listed explicitly as `{ file, selector, property, value, stage: 3 | 4, item: N }`. A listed literal passes; anything else fails.
  - A separate `it` asserts the per-stage counts.
  - Class (b) literals owned by a Stage 4 item are tagged `stage: 4`, e.g. the toggle off-track `#ccc` in `.toggle-slider` (item 6).
- **Scanner fixtures:** a `describe` block feeds the scanner inline CSS strings with known violation counts. Without these, a scanner bug passes silently. Cover:
  - comments that contain literals
  - multi-line values
  - `@media` and `@keyframes` bodies
  - `var(--x, #fff)` fallbacks
  - `color-mix()` with a literal argument
- **Dead-code guard (A8), temporary:** assert that neither `index.html` nor any `src/**` file outside the candidates imports `src/App.css`, `src/components/TabBar/`, `Preview.tsx`, `ImageRenderer.tsx`, `usePreview.ts` or `preview.css`.
  - `exportService.ts` importing `mathRender.ts` stays allowed.
  - Its failure message names the TODOS.md entry "Remove dead App.css, TabBar and Preview".
  - `tests/table-alignment-rendering.test.ts:46-49` reads `preview.css` from disk; list it with the candidates rather than editing it.
  - Delete the guard when that cleanup lands.
- **RED evidence:** run the test on the post-Stage-1 tree and record the failing count per file.

### WI-2.2 — Value-preserving tokens — M
- Add proposal tokens only where their value equals the current literal. These are candidates to confirm against Appendix A:
  - the UI font-size ramp tokens (12/13/14px sites)
  - `--radius-control`, `--radius-popover` and `--radius-inner` (DR23), only at sites where both the value and the DR23 role already match. Every other radius goes on the deferred list for Stage 3, because snapping it changes pixels.
  - `--motion-duration-fast` (the 0.15s sites only)
  - the icon size tokens where current sizes match
- Theme-independent tokens go in `globals.css :root`. Theme-specific tokens go in both theme files together (rule 31 authoring rule 1).
- Class (c) resolutions come from the answers to Q6–Q10. A10 applies: 3 or more unrelated uses gets a semantic token; fewer uses stays an open question, with no invented token.
- **Rule edit (DR14), in the first token commit:** rule 31's "Token rationale and the decisions log live in the design doc that root `DESIGN.md` marks as current" gains an interim clause. While the UI redesign is in progress, its new and redefined tokens are logged in `docs/design/mdpro-ui-new/DESIGN.md` § Tokens. Any other token still goes to the current doc. WI-5.5 removes the clause.
- Add or confirm each new token's row in DESIGN.md § Tokens (rule 31 authoring rule 4, with the DR14 clause) without mirroring values (rule 31:18-19).
- Don't copy any value into this plan or DESIGN.md; cite `proposal-ab.html:21-61`.

### WI-2.3 — Migrate class (a) literals, file by file — M
- Replace class (a) literals with the equal-value tokens. Leave class (b) literals, which stay on the deferred list.
- Update CSS-pinning tests when an assertion names a literal that became a token. Name each updated test in the report:
  - `tests/design-tokens-accent-danger.test.ts`
  - `tests/settings-row-layout.test.ts`
  - `tests/source-scroll-layout.test.ts`
  - `tests/source-table-cell-highlight.test.ts`
  - `tests/milkdown-table-cell-highlight.test.ts`
  - `tests/milkdown-image-resize.test.ts`
  - `tests/milkdown-table-resize-handle.test.ts`
  - `tests/highlight-rendering.test.ts`
  - `tests/wide-table-fit-to-width.test.ts`
  - `tests/table-alignment-rendering.test.ts`
  - `tests/table-context-menu-component.test.ts` reads only TSX and is not affected.

### Stage 2 acceptance criteria
- [ ] G0 passes
- [ ] `tests/css-tokenization.test.ts` was shown failing before migration (counts in the report) and passes now
- [ ] Every remaining non-token literal is on the rule 31 allowlist, the z-index table, an approved exception, or the deferred list. The deferred list contains only class (b) entries, each tagged with its stage (3 or 4) and item.
- [ ] The computed-style diff against the Stage 0 baseline is empty for every `pnpm dev` surface × theme; Tauri-only cells show no visible difference. A mismatch is a bug to fix; never re-baseline in Stage 2.
- [ ] Every new token is declared in its correct file (`:root`, or both theme files) and documented in DESIGN.md without values
- [ ] Literal counts per file (before → after) are reported
- [ ] `CHANGELOG.md` `## [Unreleased]` has an entry for Deliverable A
- [ ] **STOP (Deliverable A):** the report is posted, the commit split is proposed, and the user has replied

**Proposed commit split (A, proposal only):**
1. `refactor(css): ordered styles/index.css entry and app CSS reader`
2. `refactor(css): split globals.css into ordered section partials`
3. `test(css): tokenization guard with deferred list`
4. `style(css): value-preserving token migration`

**Rollback:** revert the commits in reverse order. Each one leaves the build and tests green.
