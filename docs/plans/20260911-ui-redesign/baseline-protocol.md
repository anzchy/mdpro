# UI redesign plan — Baseline and working protocol

Part of [the UI redesign plan](../20260911-plan-ui-redesign.md), which holds the sources of truth, decisions, open questions, acceptance criteria and tasks.

## Baseline (observed at `0a3675e`)

> **Rule: a claim about repository state cites `git show HEAD:<path>`, never the working tree.** A dirty file makes the two disagree silently, and this document got that wrong three times in one review round — the tdd-guardian config under **§ Gates and tools**, the Stryker exclusions in `risks.md`'s E29 row, and WI-0.0's instruction to edit a file that does not exist on master. Two of the three carried a **"verified"** date, which is the dangerous part: the tag suppresses the next reader's doubt while the oracle underneath it was wrong. Before writing any observed fact here, run `git status --porcelain <path>`; if it comes back `M` or `??`, say which shape is on HEAD and which is local, and never cite line numbers from an untracked file as if they were repository facts.
>
> **Companion rule: checking that a citation *resolves* is not checking that it resolves to *what the text claims*.** Only the second is worth anything, and the two rules fail in opposite directions — the one above catches the wrong oracle, this one catches the right oracle read carelessly. Rank a stale `file:line` by how it fails, not by whether it is wrong. A citation to a missing file fails **loudly**: the reader runs `git show` and gets an error, so the document stops them. A citation whose line numbers still resolve to real but unrelated content fails **silently, into a wrong belief** — it hands the careful reader a confirmation. The instance that produced this rule: `decisions.md`'s E29 row cited `package.json:51-52` for two Stryker devDependencies, but on HEAD those lines are `@tauri-apps/cli` and `@types/katex` and the file contains no `stryker` at all. So when a cited path is dirty or untracked, do not merely label it uncommitted — state what the cited lines actually contain on HEAD, which pre-empts the misleading resolution. Correct the **canonical decision log first**: an error there outlives the same error in a stage file, because readers treat that log as settled fact rather than as a working note.
>
> **Third rule, and the only one that fails at land time: re-sweep every `file:line` in a document immediately before committing it, not when writing it.** The two rules above catch an error at write time. This one catches an error that did not exist at write time. A citation is not a fact about a file, it is a fact about a file *at a revision*: a commit anywhere else in the tree can silently invalidate a citation sitting in your uncommitted work, and nothing reports a conflict, because both trees were correct when written and the citation still resolves. This is not hypothetical and it is not rare — it happened four times in this review round, twice inside this very rule block. Two sessions sharing one working tree make it routine: one session's commit shifts line numbers and *resolves problems* inside the other's pending edits, and the other session gets no signal at all. The window between authoring a citation and landing it is exactly when it rots, so a sweep at write time proves nothing about what you are about to publish. **There are two such windows, and they break different checks — do not collapse them.** A *save* in a shared working tree invalidates working-tree-relative verification; a *commit* invalidates HEAD-relative verification. Since the first rule above mandates the HEAD-relative check, the operative window for anyone following this protocol is the **commit**: a save-time framing is correct only for a reader doing the thing rule one forbids, so stating it that way would quietly contradict rule one. Verified on this very document — `git show 480c084^:…/baseline-protocol.md | sed -n 74p` is the tdd-guardian config bullet, `git show 480c084:…` at the same line is the large-file warning, and the file was clean throughout, so the commit is what moved it on master. The citation was HEAD-correct when written and HEAD-wrong an hour later, with no signal on either side.
>
> **Therefore, for citations from one plan document into another, cite an anchor that does not move — a section (`§ Gates and tools`) or a row key (`decisions.md`'s E29 row) — never a line number.** These documents are rewritten continuously while the code they describe sits still; a line number into a sibling plan doc is stale on arrival. But the axis is **not** doc-versus-source, and stating it that way was a bug in this rule's first draft: applied literally it condemned five citations that were correct. The real test is whether the cited file changes **under this plan**. `docs/design/mdpro-ui-old/DESIGN.md` is frozen and read-only by constraint, and the index deliberately establishes `old DESIGN.md:N` as a citation form; its `:76` and `:122-125` were re-verified and all five land exactly on what they claim, so they stay line numbers. Conversely, a *source* file is not safe merely for being source if this plan rewrites it. The sharpest case is a citation that rots by its own instruction: `stage-2-tokenize.md` cited `TODOS.md:200` in the very sentence that orders that entry's title rewritten, so the pointer was guaranteed stale while the quoted title was the durable part. Cite the durable part. This rule was adopted on reasoning and then tested by accident, which is worth recording as evidence rather than as argument: `### Gates and tools` stood at `:76` on `860caa0` and `5430163`, moved to `:78` on `e1305f4` when a citation two lines above it was re-anchored, and moved again when the seventh and eighth rules below were added — one heading, its text never edited, three different line numbers across three consecutive commits, none of which had anything to do with that section. Every anchor citation to it survived untouched; a line citation would have broken three times in a row, and renumbering it after each break would have looked like maintenance. Note that this sentence names the commits and the *event* rather than the heading's current line number, because a note asserting where the heading sits today is exactly the citation that its own neighbours will rot.
>
> **Sixth, the sweep covers every statement your edit makes false — not only the lines your edit touches.** The rules above all assume the defect is somewhere you looked. This one is about the defect you create at a distance. `8de8b07` marked Q2 and Q10 answered in the Open questions table; its diff is `@@ -120,24 +120,26 @@` and never comes within three hundred lines of the `GSTACK REVIEW REPORT`'s **UNRESOLVED DECISIONS** block, which went on listing both as "proposed; confirm at the Stage 0 gate". Before that commit the two agreed; after it they contradicted, and the same block also named `--color-muted` as one of Q6's replacements after the table had established that it would be a no-op. So the commit did not touch the defect and is nonetheless what caused it. "I did not edit that region" is no defence, and **a diff-scoped review cannot catch this class by construction**, because the whole of the evidence lies outside the diff. When a commit changes the *status* of a fact — open to answered, proposed to decided, present to deleted — grep the document set for the fact, not for the lines. A summary that contradicts its own canonical table is worse than a stale pointer: nothing about it looks broken.
>
> **Seventh, file-granularity tooling cannot enforce section-granularity ownership.** `git add <path>` stages a file, not the part of it you wrote, so in a working tree two efforts share, the obvious command silently lands someone else's unfinished work under your commit message and your name. This is not a discipline problem that care fixes; the tool has no unit small enough to express the intent. When this rule was written the plan index held 4 added lines belonging to the Q6 decision and 45 belonging to an unrelated cross-plan sequencing effort, and `git add` on it would have committed all 49. `git add -p` is not the escape — it requires a terminal and is unavailable to an agent. Split the diff and apply only the hunks you own with `git apply --cached`; a zero-context (`-U0`) diff requires `--unidiff-zero` or it fails with "patch does not apply". Then prove the split by **content, before committing**: added-line counts per owner, plus one marker that must appear in your half and one that must not. Asserting is worth more than re-reading the hunks, because an assertion fails loudly and a careful re-read fails silently. Deferring the commit instead is the safer-looking option and is usually wrong — it parks a landed decision behind someone else's schedule and leaves the citations rotting per the third rule. When such a split is spread over several commits, land the **fragile** one first: unstaging two simple files is cheap to redo, re-deriving a hunk split is not.
>
> **Eighth, a plausible reading of an inconsistency is more durable than a wrong one.** Every rule above assumes that looking harder helps. This one is about the check that cannot fail, because it stopped the moment a story fit. When two statements in this document set disagree, the mind supplies an explanation — *stale but harmless*, *an older draft*, *a different convention* — and a good explanation ends the investigation more effectively than a bad one would. Both of this round's worst errors had exactly that shape. A summary block contradicting its own canonical table was written off as a harmless lag, when both had been on master simultaneously and one of them was simply wrong. And five `old DESIGN.md:N` citations, verified against the wrong one of the repository's three `DESIGN.md` files, resolved to "shadow." and a run of blank lines — which read as convincing evidence of rot, and was in fact evidence of the wrong oracle, the failure the first rule exists to prevent. Note that a *wrong file that resolves* is the second rule's silent failure wearing the first rule's costume. **The resolution of two disagreeing statements is the commit history, not the most charitable reading**: `git log -S'<the fact>'` says which one changed and when, and that answer is not open to interpretation. Treat a satisfying explanation arrived at without running that command as an unverified hypothesis, and be most suspicious when it is the *first* thing you thought of.
>
> **And sweep the sentence, not just the pointer.** Checking that a citation points somewhere real is the weaker test; the stronger one is whether the claim wrapped around it is still true. Both defects found this way were of that kind — a row still describing as *open* a problem another commit had already *fixed*. A pointer that resolves and a claim that holds are independent properties, and a document is only as good as the second.

### Token files

- `src/styles/globals.css` `:root` (:1-47) declares these tokens:
  - colors, `--shadow-soft`, fonts
  - layout: title bar, traffic lights, sidebar, bottom tabs, content width
  - the three runtime editor tokens
  - the `--settings-*` tokens and the semantic aliases
- `src/styles/themes/light.css` and `dark.css` declare the color set, the `--settings-*` tokens and the aliases. `--shadow-soft` exists only in `:root`.
- `src/main.tsx:3-5` imports `globals.css`, then `light.css`, then `dark.css`.

### Literal inventory

| File | Lines | Color literals | px font-sizes |
|---|---|---|---|
| `src/styles/globals.css` | 1918 | 49 | 88 |
| `src/components/Editor/MilkdownEditor.css` | 269 | 1 | 1 |
| `src/components/Preview/styles/preview.css` (dead-code candidate, DR10; out of scope) | 139 | 1 | 2 |
| `src/components/BottomTabs/BottomTabs.css` | 116 | 2 | 3 |
| `src/components/Editor/ImageContextMenu.css` | 65 | 0 | 1 |
| `src/plugins/milkdown/inlineEditPlugin.css` | 39 | 0 | 0 |
| `src/plugins/milkdown/imagePastePlugin.css` | 25 | 0 | 1 |
| `src/plugins/codemirror/wysiwygDecorationsPlugin.css` | 16 | 0 | 1 |

`globals.css` also contains non-`var()` declarations of these kinds: 47 `border-radius`, 7 `transition`, 5 `z-index`, 1 `box-shadow`.

### Hotspots feeding work items

- **Hardcoded accent fills (item 1):** `globals.css:1032` and `:1747`.
- **Sub-12px font sizes (item 12):**
  - `globals.css`: `:122`, `:219`, `:532`, `:578`, `:929`, `:1245`, `:1431`, `:1682`, `:1690`, `:1774`
  - `wysiwygDecorationsPlugin.css:5`
- **Transitions (item 11):**
  - `globals.css`: `:639` (0.05s), `:1335` (0.2s), `:1347` (0.2s), `:1423`, `:1629` (includes 0.3s), `:1667`, `:1739`
  - `BottomTabs.css`: `:24`, `:66`, `:105`
  - Only the 0.15s durations match the proposal's fast-duration token.
- **Focus:** only two `:focus-visible` rules exist (`globals.css:572`, `:648`). Item 7 adds `.toolbar-button:focus-visible`.
- **Running badge and toggle track (item 6):** `.mcp-status-badge.running` at `globals.css:1371-1372`; the toggle off-track at `:1334`.
- **Settings rows (item 5):** `globals.css:1296`, `:1301`, `:1314`; `.toggle-switch` at `:1314`.
- **Settings rail (item 14):** `.settings-sidebar` at `:904`; `.settings-category-btn` at `:937`, with hover at `:948` and active at `:952`. The `--settings-btn-*` tokens are at `light.css:21-22`, `dark.css:21-22` and `globals.css:40-41`.
- **Mode label (item 9):** `.sidebar-mode-label` at `src/App.tsx:1128` and `src/components/Sidebar/index.tsx:39`.
- **Discard (item 13):**
  - `ConfirmDialog.tsx:42,52` renders both buttons as `.toolbar-button`.
  - A `.toolbar-button.danger` variant already exists at `globals.css:1195`.
  - Callers: `BottomTabs.tsx:83` and `App.tsx:1180` ("Discard changes"). `Sidebar/Sidebar.tsx:53` is a third, in a component nothing renders.
  - The confirm button has `autoFocus` (`:53`), and the card uses `aria-label` (`:37`). There is no Tab trap and no backdrop click (DR8).
- **Icons (item 4):** `SettingsDialog.tsx:30-38` and `BottomTabs.tsx:73`.
- **Syntax (item 2):**
  - `src/components/Editor/extensions/syntax.ts:3` uses `defaultHighlightStyle`.
  - `src/components/common/settings/editorPrefApply.ts:183-186` switches to `oneDark`.
- **Fonts (item 3):**
  - Source and WYSIWYG both use `--editor-font-family` (`globals.css:336`, `MilkdownEditor.css:43`).
  - The `fontFamily: "system"` default is at `src/types/preferences.ts:284` and `src-tauri/src/models/preferences.rs:568`.
- **Dead-code candidates:**
  - `src/App.css` (19 color literals, imported nowhere)
  - `src/components/TabBar/` (re-exported only by its own `index.ts`)
  - the Preview pane (DR10): `src/components/Preview/Preview.tsx` is imported nowhere since `4570de3`; `ImageRenderer.tsx`, `styles/preview.css` and `src/hooks/usePreview.ts` are used only by it. `mathRender.ts` in the same folder is live (`exportService.ts:4`).
  - the old document list: `src/components/Sidebar/Sidebar.tsx` is re-exported at `Sidebar/index.tsx:54` but rendered nowhere, and `FileItem.tsx` is imported only by it (`Sidebar.tsx:3`). The WI-2.1 dead-code guard must allow that re-export or name it.
  - the large-file warning (`useDocument.ts:31`, `:66-68`, `:101-103`, `:126-128`; `App.tsx:499-503`): it warns above 10 MB, and the backend already refuses those files (`src-tauri/src/commands/file.rs:16`, `:162-168`)

### Gates and tools

- `pnpm build` (`tsc && vite build`), `pnpm test:run` (`vitest run`), `cd src-tauri && cargo test`. **Correction (E25): all three run in `.github/workflows/ci.yml` only on `tags: ['v*']` and manual dispatch** (`ci.yml:2-6`). There is no pull-request or push-to-master trigger, so today none of them gates a merge, and all 1138 tests are skipped on every merge path. WI-0.0 restores that gate. Note also that `tsc` type-checks only `src` (`tsconfig.json:23`), so no test file is type-checked (E28).
- `pnpm dev` serves localhost:1420 without Tauri APIs; `pnpm tauri dev` runs the full app.
- `.claude/tdd-guardian/config.json` has `enabled: true`, and **exists in two different shapes — check which one you have before relying on anything below.** *(Re-corrected 2026-09-12, second pass: the first "Correction" on this line was itself wrong. It read the working tree and declared `lanes` present and `testCommand` absent as repo facts. `git status --porcelain` reports the file as `M`, and `git show HEAD:.claude/tdd-guardian/config.json` has zero occurrences of `schemaVersion` and `lanes` — so on master the opposite is true.)*
  - **HEAD (what a fresh clone gets) is v1:** keys are `enabled`, `testCommand`, `coverageCommand`, `coverageSummaryPath`, `thresholds`, `enforceRedGreenRefactor`, `blockCommitOnFailure`, `stack`, `packageManager`. No `lanes`, no mutation keys.
  - **The uncommitted working tree is v2:** `schemaVersion: 2` plus a `lanes` array — `unit` (`pnpm exec vitest run --coverage`, `gateOn: ["taskCompleted", "commit"]`, `coverageSummaryPath: coverage/coverage-summary.json`, `probeCommand: pnpm exec vitest list`) and `rust` — plus `coverageThresholds`, `coverageMode`, `requireMutation`, `mutationCommand` and `mutationGateOn`. WI-0.0 owns committing this migration.
  - Consequence for ordering is unchanged and applies to whichever shape is live: **the coverage command already runs `--coverage`**, so until E27's `coverage.include` fix lands it measures against the 97898-line denominator; no threshold may be written into this config before WI-0.0. Readiness is still confirmed in WI-0.1.
  - **Method, because this line got it wrong twice:** a plan document asserting repo state must cite `git show HEAD:<path>`, never the working tree. A dirty file makes the two disagree silently.
- `CHANGELOG.md` has a `## [Unreleased]` section — cited by that heading, not by line, because the project constitution adds an entry under it for every release-affecting change, so its line number moves on a schedule this plan does not control.

---

## Working protocol (applies to every stage)

**Per work item** (`/feature-workflow` + `/tdd-guardian:workflow`):
1. Preflight: re-verify the cited file:line facts and record discrepancies.
2. RED: write or adjust a test that fails for the right reason. CSS-only changes have no unit test (rule 10) but must pass the screenshot and tokenization gates.
   - **E26 exemption:** a behavior-preserving move (a CSS split, a pure extraction) has no honest RED — inventing a failing test for it is theater. It lands as passing characterization before and after, so "every work item lands RED to GREEN" does not apply to it.
   - **E26 migration rule:** when the work item touches a test that asserts on production **source text** (43 of 85 files read source with `readFileSync`; 41 assert on it), add the behavioral characterization and delete the superseded regex assertions in the **same** commit, before the commit that changes production code. Never migrate the suite wholesale.
3. GREEN, then refactor.
4. Run the common gate (below).
5. Update the manual test guide (A11).

**Common gate G0** runs at the end of every work item and every stage:
- [ ] `pnpm build` exits 0
- [ ] `pnpm test:run` exits 0; no newly skipped tests; no assertion deleted to get green
- [ ] `cd src-tauri && cargo test` exits 0 (required whenever Rust changed; otherwise run once per stage)
- [ ] No file outside the work item's declared file set changed, compared with the baseline `git status --porcelain` saved in WI-0.1 (the tree already has unrelated changes)
- [ ] No new dependency: `git diff package.json src-tauri/Cargo.toml` is empty, apart from the **four** E7/E28 devDependencies, which land in WI-0.0's chore PR before Stage 0 — not in WI-1.0. **This check does not start from zero (verified 2026-09-12):** `package.json` already carries two uncommitted additions, `@stryker-mutator/core` and `@stryker-mutator/vitest-runner` (both `^10.0.0`), plus 1337 uncommitted `pnpm-lock.yaml` lines. WI-0.0 resolves them either way (E29); until it does, compare against the WI-0.1 baseline rather than against an empty diff, or this gate fails on work it did not cause
- [ ] No screenshot, no `.prompts/` artifact, and no conversation content in the diff
- [ ] `pnpm coverage` exits 0 and no metric fell below its recorded threshold (E27; from WI-0.0 onward)
- [ ] The Milkdown browser suite exits 0, once it exists (E31). G0 names it explicitly, so the original three commands cannot pass while the plan's most important regression is skipped.
- [ ] **Performance (E39):** the render-isolation assertions pass — 100 content updates in separate `act` steps produce zero additional commits outside the owning region, and a typing burst schedules exactly one count. These are deterministic commit-count and task-count assertions. FPS, heap and tight millisecond thresholds are **not** part of this gate and must never be made blocking
- [ ] Nothing committed or pushed

**Stop protocol:** there are five stops: end of Stage 0, and end of Stages 2, 3, 4 and 5.

At each stop:
1. Post the stop report (template at the bottom).
2. Propose the commit split for that deliverable.
3. Wait for the user's explicit reply.

Do not start the next stage without that reply.

**Visual evidence protocol (E5):**
- **Zero-change stages (1–2):** the proof is a computed-style snapshot, not a visual comparison.
  - A throwaway script kept outside the repo (`$TMPDIR/mdpro-redesign/snapshot.js`) runs through `/browse` against `pnpm dev`.
  - For each Appendix B surface, in both themes and at a fixed viewport, it walks a fixed selector list. It records `getComputedStyle` for the A5 property families plus the box size, including `::before` / `::after`, and writes sorted JSON.
  - It also puts each surface into the states the selectors style (checked, disabled, focus-visible, an open modal, a scrolled container) and asserts that each state actually applied, so a missed state fails instead of producing an empty diff. A state that script cannot force (e.g. hover) is marked manual in the index.
  - Before and after files are compared with plain `diff`; an empty diff passes. Screenshots are still taken, as reference only.
  - Chromium is not the engine that ships. A representative subset is also collected inside `pnpm tauri dev` through WebView DevTools and diffed the same way: main window Source, one Settings page and one modal, in both themes.
- **Sign-off stages (3–4):** the screenshots the user signs off on are taken in `pnpm tauri dev` (WKWebView). `/browse` is Chromium, and rules 30/34 require visual QA in Tauri. `/browse` shots are fine for iteration.
- Capture Tauri-only surfaces manually in `pnpm tauri dev`.
- Each before/after pair uses the same window size and scale (1×, or the DR17 2× check), recorded in the index.
- A cell that cannot be captured is marked in the matrix, and the user is asked to capture it. Never skip a cell silently.

**Contrast protocol:**
- Compute ratios from resolved colors, in both themes, with a throwaway script outside the repo. Record a table.
- Failures are flagged, not silently retuned.

**Rule 33 protocol:**
- Tab through every changed surface in both themes: at the default window, at the 400×640 minimum (DR16), and with `zoom: 2` set on `<html>` from Web Inspector in `pnpm tauri dev` (DR17). mdpro has no page zoom, so 200% browser zoom can't be reached.
- Modals loop Tab, and Esc returns focus to the invoking control.
- Where `/browse` cannot drive focus, or a check needs Web Inspector, ask the user to run it, and record who ran it.

---

## Definition of "100% tokenized" (A5)

Applies to every app-owned `src/**/*.css` file except `globals.css :root`, `light.css`, `dark.css`, third-party CSS (highlight.js, KaTeX) and the dead-code candidates. The dead-code exclusion holds only while they stay unimported: the tokenization test asserts that no `src/**` file outside the candidates, and not `index.html`, imports them, and any such import brings the file into scope.

- **Color properties** (color, background, border, outline, fill, stroke, box-shadow, caret-color, text-decoration-color) may use only `var(--…)`, `color-mix()` over `var()`s, `transparent`, `currentColor` or `inherit`.
- **Must use `var(--…)`:** font-family, chrome font-size, border-radius, transition/animation duration and easing, icon width/height.
- **Allowed literals:**
  - the rule 31:58-76 list
  - `em` / `%` sizes inside editor and preview content
  - z-index values from the rule 31:83-91 table
- **Enforcement:** `tests/css-tokenization.test.ts` (WI-2.1).
