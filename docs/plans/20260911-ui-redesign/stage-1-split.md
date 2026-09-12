# UI redesign plan — Stage 1

Part of [the UI redesign plan](../20260911-plan-ui-redesign.md), which holds the sources of truth, decisions, open questions, acceptance criteria and tasks.

## Stage 1 — Split `globals.css` (Deliverable A; zero visual change)

**Entry:** Stage 0 gate passed.

### WI-1.0 — Test tooling (E7, E28) — S
- **Superseded in part by WI-0.0 (E28).** The dependencies, the widened Vitest include, the `tests/` type checking and the explicit `afterEach(cleanup)` all land in the chore PR **before** Stage 0, because a `.test.tsx` added without them is neither discovered nor type-checked. WI-1.0 is then a verification step, not an installation step.
- Confirm WI-0.0 landed: the four devDependencies are present at the E28 floors — `@testing-library/react` 16.1.0, `@testing-library/dom` 10, `@testing-library/user-event` 14.1 and `@testing-library/jest-dom` 6.9.1 — the Vitest include is `tests/**/*.test.{ts,tsx}`, and the JSX transform works for files under `tests/`. If WI-0.0 did not land, do that work here and record the versions.
- Nothing else in `package.json` changes. Existing tests and the jsdom environment stay as they are.
- **Timers (E28):** real timers by default; this smoke test and every later keyboard test use `userEvent.setup({ advanceTimers: vi.advanceTimersByTime })`, await each interaction, advance application debounce separately, and unmount before draining remaining timers. `delay: null` is not an acceptable workaround.
- **RED → GREEN:** the smoke test `tests/testing-library-smoke.test.tsx`
  - renders a native checkbox and presses Space with `userEvent.keyboard`
  - asserts the checkbox becomes checked
  - stays in the suite, because the Stage 4 and 5 keyboard tests rely on this tooling
- **Zero change:** the app bundle and the computed-style snapshot are unaffected.

### WI-1.1 — Ordered CSS entry and location-independent reader — S
- **Entry file (E2):**
  - Create `src/styles/index.css` containing only `@import "./globals.css";`, `@import "./themes/light.css";` and `@import "./themes/dark.css";`, one per line, in today's order.
  - `src/main.tsx` replaces its three style imports with one `./styles/index.css` import at the same position, so App's component CSS still comes first.
- **Test helper:** `src/test/appCss.ts` (rule 10).
  - It parses the `@import` lines of `index.css` and returns the app CSS in that order, per file or concatenated.
  - `tsc` type-checks it (`tsconfig` includes `src`; `@types/node` is present).
  - Its own test lives under `tests/`, because vitest collects tests only there.
- Every test that reads `src/styles/globals.css` from disk switches to the helper, with assertions unchanged: `design-tokens-accent-danger`, `settings-row-layout`, `source-scroll-layout` and `source-table-cell-highlight` (re-check with the WI-0.1 grep).
- **RED:** helper tests assert that
  1. before the split, the helper's non-theme concatenation equals `globals.css` byte for byte (after the split, the Stage 1 pure-move proof takes over this check);
  2. an `@import` of a missing file throws instead of being skipped;
  3. `index.css` is rejected if it contains anything other than comments and `@import` lines, a duplicate import, or a path that resolves outside `src/styles/`.
- **Zero change:** after the entry switch, the computed-style diff against the Stage 0 baseline is empty.

### WI-1.2 — Move sections into partials — M
- **First commit, before any move:** delete the `.toolbar-recent*` rules (WI-0.5) and the "Recent dropdown" row in rule 31's z-index table. The computed-style diff stays empty, because nothing renders those classes. The pure-move proof diffs against this commit.
- Keep `:root` tokens and base/reset rules in `globals.css` (rule 31:11-16).
- Move each other section verbatim into a partial, per the approved file map (A6). Assumed location: `src/styles/sections/<section>.css`.
- List the partials in `src/styles/index.css` immediately after `./globals.css`, in original source order. `main.tsx` is not touched again.
- Change no selector, value or rule order. Remove only the moved text.
- Plugin CSS stays co-located with its plugin (rule 50 §3). Do not pull plugin CSS into the partials.
- **Rule edit, in the move commit:** rule 32 § Single source of truth names the partial that owns each surface (app shell, sidebar, dialog backdrop, toast, settings, link insert modal) instead of `globals.css`, per the approved file map. The modal contract's "`.dialog-backdrop` + `.dialog-card` from `globals.css`" names the dialog partial. Rule 31 keeps `globals.css` for the `:root` tokens. Until this commit lands, the rule's old file names stand, so no partial exists without it.

### Stage 1 acceptance criteria
- [ ] G0 passes
- [ ] **Pure-move proof:** concatenate the new `globals.css` and the partials in import order, strip banner comments from both sides, and diff against the baseline file. The diff is empty; the exact command and its empty output are in the report. Example:
  ```bash
  diff <(git show <dead-CSS commit>:src/styles/globals.css | sed '/^\/\*.*\*\/$/d') \
       <(sed -n 's|^@import "\./\(.*\)";$|src/styles/\1|p' src/styles/index.css \
           | grep -v '/themes/' | xargs cat | sed '/^\/\*.*\*\/$/d')
  ```
  The file list comes from `index.css`, so the proof, the helper and the app share one order.
- [ ] **Built-CSS order:** in the `pnpm build` output CSS, rules appear in the same relative order as before. Spot-check the first and last selector of each partial.
- [ ] The computed-style diff against the Stage 0 baseline is empty for every `pnpm dev` surface × theme (command and empty output in the report); Tauri-only cells show no visible difference
- [ ] Every app CSS file is ≤ ~300 lines, or is listed as an approved exception
- [ ] No test assertion changed; only the file-reading paths did
- [ ] Rule 32's ownership table and modal contract name the partials; rule 31's z-index table has no "Recent dropdown" row, and no `.toolbar-recent` selector remains
- [ ] The WI-1.0 smoke test passes, and the `package.json` diff is **empty**, because WI-0.0 already added the four E7/E28 devDependencies (if WI-0.0 did not land, the diff is exactly those four)

**Rollback:** revert the partials, `src/styles/index.css` and the `main.tsx` import. `globals.css` is restored byte-for-byte from the baseline.
