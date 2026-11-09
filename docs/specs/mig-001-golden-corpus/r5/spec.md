Part of #697 (MIG-001 row). Plan: `docs/plans/20261107-mdpro_tiptap_windows_plan_v1-3.md` §5 MIG-001, §15 row MIG-001a…n. Decisions: #681 (user: "all yes"); grill record `MIG001-r1-D1`…`D29`, `D9b` (user: 「全部 yes」); r2 rulings to the delegator on MH1(c), MH3 and MH4, and planner-pane answers (user: 「全部 yes」); r3 ruling to the delegator after the review cap (user: 「r3 + scoped confirm (Recommended)」), which fixes R2-H1, R2-H2, R2-H3 and R2-M1 and Lows L1 and L3, and changes nothing else; r4 for the ADR-0129 residual #720 (user: 「Accept r3, track residual (Recommended)」, then 「让 planner 现在就做 MIG-001 的 r4，修 #720」), which fixes R3-H1 and Lows R3-L1 and R3-L2, and changes nothing else; r5 for the same residual (user: 「接受 r4，#720 继续跟踪 (Recommended)」, then 「先做 r5，再开工 a」), which fixes R4-H1, R4-M1, R4-M2 and R4-L1, and the out-of-scope `setListKind` note inside the same rule, and changes nothing else. Tier High; gated (rule 12); no ADR; no device AC (the scroll-anchor card belongs to MIG-002b). Snapshot: `docs/specs/mig-001-golden-corpus/r5/` (r1–r4 are superseded).

## Problem Statement

mdpro is about to replace its WYSIWYG engine, Milkdown, with Tiptap. What Milkdown does to a user's Markdown today is spread across about sixty D-item tests. Each of those tests was written for one defect and builds its own editor, and several of the editors leave out production plugins (tables, paste, find, edit sync). Nothing in the repo answers, in one place and without reference to an engine: "for this exact input, what bytes does mdpro write today, and which of those changes did we accept on purpose?"

Without that answer, a migration can only be judged against itself.
- A Tiptap output that differs from today's cannot be classed as an improvement, an accepted normalization or a regression.
- The tempting "check" (open a file, don't edit it, see the disk didn't change) proves nothing: mdpro never re-serializes an unedited document, so it passes on any engine.
- A characterization test is green from its first run. Without failure evidence nobody can show it would catch a loss.
- A fidelity label that nothing checks is only a claim.

Three consumers are waiting for this:
- MIG-002 (#702) needs case-ids to cite for every state-safety journey.
- MIG-009a (#695) needs a corpus subset to run the engine experiment on.
- Every later Tiptap PR needs a byte-level baseline with a defined pass rule.

## Solution

The solution is a **Golden Corpus**: hand-written Markdown fixtures. Each one carries the outputs today's editor produces, a one-line reviewed rationale, and a promise the runner **checks**.

- **Fidelity tag**: what the case promises.
  - `immutable`: the serialized bytes equal the input.
  - `semantic-roundtrip`: the input with its listed **normalizations** applied equals the output, and an edit changes only the text its action names.
  - `known-limitation`: today's output loses something; the case records the output the user would want and the defect it belongs to.
- **Action group**: what the case does.
  - `no-edit`: nothing.
  - `edited`: a scripted edit.
  - `interaction`: paste, find, link activation and the like.
- **One seam to the engine.** Cases reach the editor only through a narrow **engine driver**. This spec ships the Milkdown driver, which mounts the real editor with the full production plugin list. A later engine runs the same cases against the same files under a stated pass rule per tag. A `known-limitation` case passes on either side (today's output or the desired one), and an improvement is reported to the user to accept.
- **Content-level observations.** TOC and the large-document guard are computed from the Markdown by the engine-neutral layer, calling the real production functions. They characterize the content, not an engine. Scroll-anchor retention is a Mac device card owned by MIG-002b.
- **Failure evidence for every fidelity claim:**
  - a declarative **negative case**, which feeds the comparison that case's specific loss and must fail;
  - a **temporary-mutation receipt** per guarded path, which breaks a tracked mdpro file once and records the case going red.
- **Fourteen slices, one PR per category.** Slice a builds the tool, driver, comparator, checker, fake Tauri boundary and every action and observation, and delivers category a (empty paragraphs). Slices b…n then add data only, in parallel.

## User Stories

1. As the user, I want a single place that says what mdpro writes for each Markdown construct today, so that I can judge the Tiptap migration against my real files rather than against itself.
2. As the user, I want every accepted rewrite of my Markdown listed by name with its source and checked mechanically, so that a byte change can't hide behind a plausible label.
3. As the user, I want each current defect recorded as a known limitation with the output I'd actually want, so that the migration neither hides it nor gets credit for keeping it.
4. As the user, I want a later engine to pass a known limitation by matching either today's output or the desired one, and to be told when it matches the desired one, so that I accept improvements knowingly and never accept regressions.
5. As the user, I want to rule on every classification question (an accepted rewrite or a defect), so that the policy stays mine.
6. As the user, I want adding a fidelity tag, action group, normalization, action kind or observation kind to need my approval, so that the closed lists stay closed.
7. As the user, I want all fourteen categories and every topic I approved in #681 kept, so that coverage matches what I agreed.
8. As the user, I want a cap on how much CI time the corpus adds, and to be asked when it is exceeded, so that the corpus doesn't slow every PR silently.
9. As an implementor, I want one harness that mounts the real `<MilkdownEditor/>` with the production plugins, so that I characterize the app and not a reduced rig.
10. As an implementor, I want to write an input file, a manifest record and a rationale, and have the generator write the expected outputs, so that adding a case is cheap and mechanical.
11. As an implementor, I want each input to cite the existing test it was copied from, so that reviewers can trace it and the existing test stays unchanged.
12. As an implementor, I want a fixed action vocabulary whose anchors, marks, table sides and cell ranges are defined in engine-neutral terms, so that my edited cases mean the same thing on any engine.
13. As an implementor, I want a missing or ambiguous anchor to fail the case by name, so that a wrong anchor never silently edits the wrong place.
14. As an implementor, I want the platform set at the top of a per-platform runner file, as the repo already does, so that platform-dependent modules see the right platform at import time.
15. As an implementor, I want generation to write to a scratch directory and merge in one step, so that parallel runners never race on a manifest and a drift is never blessed in place.
16. As an implementor, I want the corpus to fail rather than generate when an expected file is missing, and to refuse write mode on CI, so that CI never invents a baseline.
17. As an implementor, I want a documented temporary-mutation procedure, including the accepted route for behaviour that lives in upstream packages, so that every receipt can be replayed.
18. As an implementor, when I meet an output that is neither a listed normalization nor a known defect, I want a defined holding state (`limitRef: pending`) and an escalation path, so that I keep working while the user decides.
19. As an implementor of category m, I want the guard decided by calling the production guard on generated content, without mounting a huge document, so that m stays fast.
20. As an implementor, I want a per-file time ceiling and a rule for what to do over it, so that I know when to split.
21. As an auditor, I want every case to carry a rationale and every mounting case's tag to be checked by the runner, so that "reviewed per case" sits on top of a mechanical floor.
22. As an auditor, I want serialized bytes checked for every case that mounts a document, including TOC, find and link cases, so that an observation can't pass while the document loses content.
23. As an auditor, I want a negative case per fidelity claim and a mutation receipt per guarded path, with the mutation diff, failing assertion and restore in the handoff, so that I can see each case is wired to the code it protects.
24. As an auditor, I want "passes at base" on a characterization receipt's replay listed as a known qualification, so that I don't read it as a broken receipt.
25. As an auditor, I want each case's `baselineSha` to be a master commit that survives rebase, so that provenance never dangles.
26. As an auditor, I want the corpus to say it characterizes jsdom and not WKWebView, and which cases (if any) run only locally, so that I don't over-read a green run.
27. As the delegator, I want each category to be one ticket and one PR, with b…n blocked only by a, so that grants and landings stay simple.
28. As the delegator, I want manifest rules (no `pending`, no missing files, coherent tags) checked by an ordinary test in the existing shards, so that later PRs that touch cases can't skip them.
29. As the delegator, I want findings (D-items, the UTF-8 BOM, ADR-accepted limits) handed to me, so that I open the issues and the corpus never fixes behaviour itself.
30. As the MIG-002 author, I want stable, never-reused case-ids and a `consumers` field, so that my journeys can cite cases that won't move.
31. As the MIG-002 author, I want the fake Tauri boundary (an in-memory file system, a byte-level write log and a fake native opener) to land in slice a as a shared helper, so that my App journeys reuse it.
32. As the MIG-002b author, I want the scroll-anchor retention claim handed to my Mac device card, so that it is proved where layout exists.
33. As the MIG-009a experimenter, I want to select cases by id and run them through a different driver under the stated per-tag rule, so that I compare engines on identical inputs and expectations.
34. As a future Tiptap driver author, I want the driver interface and every action and observation to depend on nothing engine-specific, so that I implement the driver and change no case.
35. As a D-item fixer, I want to update the case my fix resolves (bytes, tag, rationale citing the fix) without a new user question, so that fixing a defect isn't blocked by the corpus.
36. As a maintainer, I want retired cases kept and marked rather than deleted, so that old citations still resolve.
37. As a maintainer, I want a known limitation that proves a `Shipped` ledger row false to rewrite that row in the same commit, so that the ledger stays true.
38. As a maintainer, I want CRLF and UTF-16 cited from the existing Rust tests rather than re-tested in Vitest, so that each behaviour is tested once at its own boundary.
39. As a maintainer, I want math asserted literal and not rendered in WYSIWYG, so that the corpus doesn't widen math scope beyond the ledger's `Absent`.

## Implementation Decisions

### Vocabulary and identity
- **Directories and fields.**
  - The **action group** (`no-edit | edited | interaction`) is a directory: `tests/fixtures/markdown-corpus/<action-group>/<category>/`.
  - The **fidelity tag** (`immutable | semantic-roundtrip | known-limitation`) is a manifest field.
  - Both are closed lists, and `corpus:check` checks the action group against the directory.
  - A **guard-only record** (category m only) has neither. It lives in `tests/fixtures/markdown-corpus/guard-only/m/` (§ Guard-only records).
- **The fourteen categories, kept unmerged:**
  - a: empty paragraphs;
  - b: inline HTML, `<br>` and hard breaks;
  - c: reference link definitions;
  - d: lists;
  - e: GFM tables;
  - f: table paste;
  - g: marks;
  - h: blocks (math literal, not rendered);
  - i: images;
  - j: link and paste safety;
  - k: footnotes;
  - l: emoji, CJK, and the part of line endings and encodings the editor sees;
  - m: extreme input and the large-document guard;
  - n: TOC and find/replace.
- **Case-ids** are `<letter>-<kebab-slug>`, unique, never renamed or reused. An unwanted case is set to `status: retired`.

### Manifest
- **Shards.** Each category has its own manifest shard. The closed lists (fidelity tags, action groups, normalizations with their sources, action kinds, observation kinds, negative kinds) live in one lists file. Only slice a, or a change the user approved, edits that lists file.
- **`caseKind`** is `mounting` (the default) or `guard-only`. The fields below describe a mounting record; a guard-only record has its own shape (§ Guard-only records).
- **Fields in each mounting record:**
  - `caseId`, `category`, `actionGroup`, `fidelityTag`, `status` (`active | retired`).
  - `input` (a path).
  - `expected: { serialized, observation? }` (paths). `serialized` is mandatory for every mounting record. Only a guard-only record, which mounts nothing, lacks it.
  - `desired` (a path) when the case is a known limitation.
  - `action`: one action or an ordered array of actions.
  - `platform` (`any | mac | win`). `any` means no platform-specific behaviour is expected; such cases are characterized under the mac setting, and the corpus makes no cross-platform claim for them.
  - `baselineSha`.
  - `normalizations[]`.
  - For a known limitation: `limitRef` (a D-id, an issue, an ADR clause such as `ADR-0091 C7`, or `pending`), plus `reason`.
  - `guardedPaths[]`, each with its receipt id.
  - `negative`: a declarative negative case, `{ kind, … }`.
  - `consumers[]`, `derivedFrom`, `externalEvidence[]`.
  - `ci` (`shards | local-only`, default `shards`).
  - `rationale`: one line, required.

### Guard-only records (R2-H3)
A guard-only record characterizes the production large-document guard on generated content. It mounts nothing, so it has no editor output and makes no fidelity claim.
- **Only in category m**, under `tests/fixtures/markdown-corpus/guard-only/m/`.
- **Fields:**
  - `caseId`, `category: "m"`, `caseKind: "guard-only"`, `status`;
  - `recipe`: the committed recipe's path and its sha256;
  - `viewMode`: `wysiwyg | source`;
  - `expected: { observation }`: the full guard decision (the union arm with every field: `allow`; `degrade-to-source` with its reason; `withhold-table-extensions` with its table-row count);
  - `negative: { kind: "wrongObservation" }`;
  - `baselineSha`, `rationale`, `ci`, `guardedPaths[]`, `consumers[]`, `derivedFrom?`.
- **Absent, and an error if present:** `actionGroup`, `fidelityTag`, `action`, `platform`, `normalizations`, `expected.serialized`, `desired`, `limitRef`, `reason`.
- **Its rule.** The runner checks the recipe's sha256, generates the content, calls the production guard under `viewMode`, and compares the decision with `expected.observation` exactly. The `wrongObservation` negative must fail naming the case.
- **Rules that do not apply:** the untouched output, the serialized output, every fidelity-tag rule, and the rules for other engines. The guard is content-level, so the record is checked the same way whatever `CORPUS_ENGINE` selects.
- **A disputed decision** (the guard deciding what the user does not want) is a finding for the delegator, not a known limitation.

### Two outputs per case
- **Untouched output.** This is the stored text after mount, a mode switch and a save with no edit, read from the fake boundary's write log (an unedited open writes nothing). It must equal the input byte-for-byte for every mounting record. A guard-only record has neither output.
- **Serialized output.** This is what the serializer produces for the loaded document, or for the document after the case's action. It is exactly what any edit would write. It is mandatory for every mounting case (MH2).

### Executable fidelity tags (MH1)
These rules apply to mounting records only. Every reference transform below, the block splitter and the visible-text transform included, is a plain text transform kept in the engine-neutral layer. None of them uses an engine's parser.

**Rules on the baseline engine (Milkdown).** The serialized output must equal `expected.serialized` byte-for-byte. Each tag then adds its own check:
- **`immutable`.** Allowed only when the action group is `no-edit`, or for an `interaction` whose action leaves the document unchanged. Then `expected.serialized === input`, and `normalizations` is empty.
- **`semantic-roundtrip`**, in a `no-edit` case:
  - `normalizations` is non-empty;
  - applying the listed normalizations' reference transforms to the input, in list order, gives `expected.serialized` exactly;
  - removing any one listed normalization breaks that equality, so the list is minimal.
- **`semantic-roundtrip`**, in an `edited` or `interaction` case, must pass two checks (R2-H2). Both start from the **normalized input**: the input with the listed normalizations' reference transforms applied in list order (the input itself when the list is empty).
  - **The block splitter (R3-H1, R4-H1)** cuts the normalized input and the output into an alternating sequence of blocks and **separators**, at every level ADR-0091 decision 2 reads: the document, every blockquote and every list item.
    - A separator is the exact run of line breaks and blank lines between two blocks, kept as a token, byte for byte. The run before the first block and the run after the last are separators too, bounded by the start or end of their level.
    - **Inside a blockquote** the splitter first removes the container prefix from each line: `>` plus one optional space. A lazy continuation line (no `>`) belongs to the block above it. A marker-only `>` line is then a blank line, so its run is a separator.
    - **A list** is a level of its own. Each list item is one block of that level, and the run between two items is a separator of that level, so a tight list's `\n` and a loose list's `\n\n` are both compared. **Inside a list item** the splitter removes the item's marker from its first line and the item's content indent from the others; an empty or indent-only line is then a blank line, so its run is a separator.
    - At every level, a fenced code block, an indented code block, an HTML block and a table each stay one block, never cut inside. A blockquote and a list are each one block of their parent level, and their inside is the next level.
    - ADR-0091 stores an empty paragraph as a blank-line run between siblings in the document, a blockquote or a list item; inside a quote or list item the run's lines carry the container prefix (marker-only `>` lines, or the item indent). Removing the prefix first makes every such run a separator.
  - **Touched.** A block is touched when it, or any block inside it, holds part of an action's anchor or a `replace` match. `setListKind` touches every item of the list holding the caret, because it changes every item's marker.
  - Checks 1 and 2 run at every level. A touched container (a blockquote, a list or a list item) is compared through the level inside it; check 2's visible-text comparison applies to touched blocks that have no level inside them. If a touched run in the output does not have the container kinds, in order, that the action models predict, the check fails.
  1. **Unedited blocks and their separators.** At each level, every normalized-input block that is not touched appears byte-for-byte in the output, in order (inside a container, after prefix removal). The separator between any two adjacent input blocks that are both untouched (or between an untouched block and the start or end of its level) appears byte-for-byte between the same two in the output. Because every empty paragraph is a separator at its own level, this catches an empty paragraph lost, added or moved between untouched blocks, at the top level and inside quotes and list items alike. So every change outside the edited blocks comes from a listed normalization.
  2. **Action-aware text.** For each run of blocks the actions touch, the visible text of the output blocks between the same unedited neighbours equals what the actions' text models predict from the normalized-input blocks:
     - **Non-destructive actions keep their target text.** `toggleMark`, `clearFormat`, `setListKind`, `find`, `modeSwitch` and `activateLink` predict the visible text unchanged. `insertTableRow` and `insertTableColumn` predict the same cells plus empty cells on the named side; a table block is compared cell by cell in row order.
     - **Insertions add only their text.** `type` predicts its `text` inserted at the caret. `paste` predicts the visible text of its `text`, or of its `html` after the reference tag-stripping transform, inserted at the caret, or spread over the cell range in reading order.
     - **Destructive actions remove only what they name.** `delete` predicts exactly the selection's text removed. `replace` predicts the named match, or every match with `all`, replaced by `with`, and nothing else.
     - `undo` predicts the state before the action it undoes; an action sequence applies the models in order.
     - **Separators.** Every separator inside or beside a touched run (between two touched blocks, or between a touched block and its untouched neighbour or the start or end of its level) is predicted unchanged, byte for byte, unless the action names a block split or join. Only these do, and each predicts its separators exactly:
       - `type` whose `text` holds a line break (R4-M2) predicts the split in the caret's container, following ADR-0091 decisions 1–3, and every other separator unchanged:
         - in a paragraph at the top level or inside a blockquote: a new paragraph after the caret, with one blank line as the new separator (`\n\n` after prefix removal, so a marker-only `>` line in a quote);
         - in a list item's paragraph: a new item of the same list after the caret's item, with the list's own item separator (`\n` in a tight list, `\n\n` in a loose one);
         - in a fenced or indented code block: no split; the break is a literal newline in the code, compared byte for byte;
         - at the end of a container's last block with nothing typed after it: the empty paragraph it creates is dropped on write (ADR-0091 decision 3), so the model predicts the bytes unchanged;
         - two or more consecutive breaks: each break after the first predicts an empty paragraph. An empty predicted block has no bytes, so it merges with the two separators beside it into one, of the length ADR-0091 decision 1 gives (one blank line plus two line breaks per empty paragraph): `A`, two breaks, then `X` predicts `A\n\n\n\nX`;
         - in a table cell, or a second break on a new empty list item: no model. Such a case is a classification question (§ Escalation), and a model is added only with the user's approval;
       - `delete` whose selection spans blocks (§ Anchors, cross-block selection) predicts the selected blocks joined into one, removing exactly the separators and empty paragraphs inside the selection and leaving the rest unchanged;
       - `paste` whose content holds more than one block (R4-M1) predicts the caret block split at the caret and the pasted content inserted there with its **own** blocks and separators: for `text`, the separators of the text after the reference transform for N2; for `html`, those the reference tag-stripping transform produces, which writes each block element as a block and each empty paragraph element as two more line breaks in the separator (ADR-0091 decision 1). Only the two outer sides get `\n\n`, and every other separator is unchanged.
     - Any other separator change in or beside a touched run fails the check, as does a separator the action predicts but the output lacks.
  - **Visible text** is the block's bytes with whitespace kept where it is content. Outside code it removes a fixed set of Markdown punctuation (inline delimiters, link and image brackets, and line-leading block markers: heading `#` runs, `>`, bullet markers, ordered markers with their digits, task boxes, table pipes), collapses each whitespace run to one space and trims the ends. Inside a code span, a fenced or indented code block or an HTML block, every byte, whitespace included, is kept and compared literally.
  - **Not caught by the tag rule:** a markup change inside an edited block that keeps its visible text (for example a heading level changed in the block being typed into). Blank-line separators, and the empty paragraphs they encode at the top level and inside quotes and list items, are not in this gap: checks 1 and 2 compare every separator byte for byte after prefix removal. Also not caught: the spelling of the container prefix on the lines of a touched quote or list item (for example `>` versus `> ` on a marker-only line). The byte comparison against `expected.serialized`, and the auditor's per-case review of bytes against the rationale (§ Escalation), cover that block, and a later engine is still held to those bytes.
- **`known-limitation`.** `limitRef`, `reason` and `desired` are present, and `desired` differs from `expected.serialized`.

**Rules for any other engine.** A runner started with a non-default driver applies these:
- **`immutable`:** the serialized output equals the input.
- **`semantic-roundtrip`:** the output equals `expected.serialized`, or the two are equal after the whole closed normalization list is applied to both by its reference transforms. For an edited or interaction case, the two checks above must also pass. A difference that passes only through the normalizations is reported, naming them.
- **`known-limitation`:** the output equals `expected.serialized` or `desired`. Either passes, as #681 item 4 says. Matching `desired` is reported as an **improvement** for the user to accept by a case update; it is never accepted automatically. (This replaces r1's D8.)
- **Anything else fails**, the observation included.

`corpus:check` and the manifest test enforce that tags, normalizations and action groups are coherent for mounting records, and that guard-only records have exactly their own shape.

### Normalizations, r2 closed list
Each normalization has a reference transform and a source.

| id | normalization | source |
|---|---|---|
| N1 | Two-space hard break → backslash | `d188-empty-paragraph-read` D1 |
| N2 | b blank lines → ⌊(b−1)/2⌋ empty paragraphs; whitespace-only lines count as blank | ADR-0091, d188 B1/B3 |
| N3 | Leading and trailing empty paragraphs stripped | ADR-0091, D188 edge serializer, d188 B5 |
| N4 | Trailing newline added | d188 B5 |
| N5 | Legacy `<br />`-only paragraph → blank lines | ADR-0091, d188 E1 |
| N6 | A missing list marker defaults to `-` / `.` | ADR-0099 |
| N7 | Table delimiter row rewritten, cells padded | ADR-0067, table-empty-cell-serialize |
| N8 | Ragged table widened with blank cells | ADR-0067, table-empty-cell-serialize |

**Known limitations, not normalizations**, because each one changes what the user wrote:
- reference links inlined (`limitRef: D197`, ADR-0094);
- undefined references escaped;
- strong-emphasis boundary characters written as entities;
- two same-kind lists separated only by blank lines merging (`limitRef: ADR-0091 C7`).

The delegator opens a D-item for the second and third if none exists.

### Engine driver
- **Two layers.**
  - The engine-neutral layer holds the fixtures, manifest, expected files, comparator, reference transforms, content-level observations and runner.
  - The engine driver offers `mount(input, platform)`, `untouched()`, `serialize()`, `runAction(action)` and `observe(kind)`.
- `CORPUS_ENGINE` selects the driver (default `milkdown`).
- **The Milkdown driver** mounts the real `<MilkdownEditor/>` with the production plugin list.
  - It replaces only the Tauri boundary: the API modules and the native opener.
  - For determinism it also mocks logging and fixes the clock.
  - It uses the existing harness's real timers with waiting. Edit sync is flushed by a save rather than by waiting out the debounce.
- **Excluded:** no corpus case uses the reduced rigs, and no driver depends on the editor port (MIG-005).

### Actions (closed; finalized and implemented in slice a)
**Anchors** address text in **rendered text**: the visible characters of a document's text, block by block, with mark boundaries ignored.
- An anchor never falls inside inline HTML source or Markdown punctuation. A caret never falls on a block boundary.
- **A cross-block selection** (R4-L1) writes each block boundary it crosses as one `\n` in its `text`, matched against rendered text in which consecutive blocks' texts are joined by one `\n` per boundary. An empty paragraph has empty text, so a selection from `a` across one empty paragraph to `b` is written `a\n\nb`. A caret's `text` never holds `\n`.
- An anchor never splits a grapheme cluster.
- Text is matched exactly, with no Unicode normalization.
- `occurrence` is 1-based in document order and defaults to 1.
- Anchor forms:
  - a caret: `{ text, occurrence?, edge: "before" | "after" }`;
  - a selection: `{ text, occurrence? }`;
  - a cell range: `{ cells: { table, from: [row, col], to: [row, col] } }`, where every index is 1-based, row 1 is the header row, and `table` counts tables in document order;
  - a cell: `{ cell: { table, row, col } }`, indexed the same way.
- A missing anchor, an ambiguous one (`occurrence` beyond the count) or one that splits a grapheme fails the case with an anchor error naming the case.

**Action kinds:**
- `type { at: caret, text }`
- `delete { range: selection }`
- `toggleMark { range, mark }`, where `mark` is one of `strong | emphasis | code | strike | highlight | underline`
- `clearFormat { range }`
- `setListKind { at: caret, to: "bullet" | "ordered" }` (the list item holding the caret)
- `paste { at: caret | cell range, html? , text? }`
- `undo`
- `insertTableRow { at: cell, side: "above" | "below" }`
- `insertTableColumn { at: cell, side: "left" | "right" }`
- `find { query, caseSensitive, wholeWord }`
- `replace { query, with, all, caseSensitive, wholeWord }`
- `modeSwitch { to: "source" | "wysiwyg" }`
- `activateLink { link: selection }`: a plain click on the link holding the selection. There is no modifier: the guard has no modifier branch.

A category that needs a new kind gets it only with the user's approval.

### Observations (closed; finalized and implemented in slice a)
Observations use Markdown-source or rendered-text terms only, never engine node names or positions.

**Content-level** (computed by the engine-neutral layer by calling the production functions; they characterize no engine):
- `toc`: the production TOC parser applied to the serialized output, giving `[{ level, text, id }]`.
- `largeDocGuard`: the production large-document guard decision for the case's content (for a guard-only record, the content its recipe generates), under the view mode the case names. Its result is the production union:
  - `allow`;
  - `degrade-to-source` with its reason;
  - `withhold-table-extensions` with its table-row count.

**From the driver:**
- `find`: `{ query, options, matches: [{ text, occurrence, block }] }`, where `block` is the 1-based index of the top-level block.
- `pasteSafety`: `{ forbiddenFound: [] }`, found by scanning the serialized output and the rendered DOM for script elements, `on*` attributes and refused-scheme URLs. Any entry fails the case.
- `linkActivation`: `{ outcome: "refused" | "external" | "same-app" | "no-href", reason?, defaultPrevented, propagated, openerCalls: [href] }`. The driver derives it from what the real guard did, never by classifying the URL itself (R2-M1):
  - `refused`: the mocked logger received `editor.milkdown.link.blocked` and the click did not propagate past the editor container; `reason` is that event's reason (`scheme | resolved-mismatch`).
  - `same-app`: the mocked logger received `editor.milkdown.link.in_document`, the click propagated, and the opener was not called.
  - `external`: the opener was called (the driver awaits the opener import before reading its log), the click propagated, and neither event was logged.
  - `no-href`: an anchor without `href`; the click was cancelled and propagated, with no event and no opener call.
  - Any other combination fails the case as an unclassified activation.
  - `propagated` is read from a bubble-phase listener the driver places on an ancestor of the editor container. A capture-phase listener would see every click, including refused ones, so it is not allowed.
- `renderedMath`: `{ count }`, the number of rendered math elements. It must be 0 while the ledger has math `Absent`.
- `imageSources`: `[{ markdownSrc, resolvedKind: "asset" | "url" | "unresolved" }]`.
- `selection`: `{ text }`, the rendered text currently selected, or empty.

**Expected files.** An interaction case writes `expected.json` for its observation. Every mounting case writes `expected.md`.

**Scroll anchor.** Retention of the scroll anchor across a mode switch is not a corpus observation. It is the MIG-002b Mac device card (ADR-0144), linked from ticket n.

### Generation, checking and determinism (MM1, MM2)
- **Inputs** are hand-written `.md` files copied from the cited test's literal. Existing D-tests stay unchanged.
- **Generate.**
  - `pnpm corpus:generate` runs the runners in write mode. Each runner writes per-case outputs into a scratch directory, never into the tracked tree.
  - One merge step then copies changed outputs into the fixture tree and writes the shards in canonical key order.
  - `baselineSha` is set to the merge-base of the branch with `master` at generation time. A case whose bytes are unchanged keeps its old `baselineSha`.
  - The generator never writes an input, a rationale or a `desired` file.
- **Guards on generation.**
  - The runners refuse write mode when `CI` is set.
  - A missing expected file fails the case. It is never generated during a normal run.
- **`pnpm corpus:check`** validates the manifests read-only:
  - files exist and are listed;
  - ids are unique and well formed;
  - values come from the closed lists;
  - action groups match their directories;
  - tags, normalizations and action groups are coherent;
  - each known limitation has `limitRef`, `reason` and `desired`;
  - each fidelity claim has its declared `negative`;
  - each case has a rationale and a `baselineSha`;
  - key order is canonical.

  It writes nothing.
- **`pnpm corpus:determinism`** is a separate local command. It generates twice into two scratch directories through `scripts/heavy-lock.sh` and compares the results.
- **The manifest-validation test** applies `corpus:check`'s rules to the real shards and also rejects `limitRef: pending`. It is an ordinary test in the existing shards.
- **Gate classification.** This adds no new CI job, no `ci-gate` change and no new landing rule. The delegator classifies it, and it is listed in the handoff as a classification point.
- **Byte comparison** is the normal Vitest run in the existing four shards.

### Runner layout (MM10) and CI budget (MM6, MM7)
- **Placement** follows rule 10 (ADR-0098):
  - runners at the `tests/` root as `corpus-<letter>-<category>.<any|mac|win>.test.tsx`, one per category per platform present;
  - driver, comparator, reference transforms and fake boundary under `tests/support/corpus/`;
  - the CLI test and the manifest test under `tests/tooling/`;
  - fixtures under `tests/fixtures/markdown-corpus/`.
- **Platform.** Each runner sets `navigator.platform` before any import. Platform is an injected input, never a `skipIf`. A case jsdom cannot simulate doesn't belong here.
- **Origin (R2-H1).** A runner whose cases use `activateLink` (category j's runner, and slice a's driver test for `activateLink`) sets the production origin with the file-level docblock `@vitest-environment-options { "url": "tauri://localhost/" }`, as the existing production-origin link-guard test does. At jsdom's default `http://localhost:3000/` a relative link resolves to an openable URL and goes to the opener; that is the closed C1 defect, and the corpus never records it as a baseline. Other runners keep the default origin.
- **Time limits:**
  - Every case takes under 2 s under coverage (rule 10, ADR-0050). A case that can't is made smaller; failing that, it moves to the slow tier with `ci: local-only`. Slow-tier cases **do not run in PR CI**, and the handoff lists each one with its local result.
  - Each runner file takes at most 60 s under coverage; over that, it is split by action group.
  - The whole corpus adds at most 5 minutes across the four shards; over that, the delegator stops further grants and asks the user.
  - Each handoff reports its files' times and the running total.

### Fake Tauri boundary
- Slice a lands a shared helper that mocks the Tauri API modules and the native opener. It provides:
  - an in-memory file system;
  - a write log of the exact bytes of every `save_file`, `save_draft` and `delete_draft`;
  - an opener log.
- MIG-002's App-journey harness reuses it.

### Baseline and regeneration (MM3)
- **`baselineSha`** is a master commit (the merge-base), so it survives the rebase before landing.
- **The shared "M0 baseline SHA"** (master HEAD at the first M0 grant, #681/680) remains the reference point for WIN-001 and the other M0 items. The corpus records its per-case SHAs alongside it; this is a named override of plan §5 item 6's single frozen SHA.
- **A regeneration that changes a case's bytes** shows that case's diff in the PR and a new rationale naming the commit that caused it.
- **A D-item fix that resolves a known limitation** updates the case itself: the bytes, the tag, and a rationale citing the fix.

### RED evidence (MM9; #681 item 6)
- **Negative cases** are declarative, one per fidelity claim, and run by the runner, not written as separate test files.
  - Kinds: `dropText`, `alterByte`, `corruptSerialized` (keeps the observation and the untouched bytes and corrupts only the serialized output), `wrongObservation`, and `matchDesiredOnBaseline` (for a known limitation).
  - Each negative must fail the comparison with that case's id.
  - They prove the comparison catches that specific loss. Only the mutation receipt proves the wiring to the engine.
- **Temporary-mutation procedure:**
  1. Edit a tracked mdpro file under `src/` on the guarded path.
  2. Run the category runner and record the RED with the receipt tool (id `MIG001-<letter>-…`).
  3. Restore the file by editing it back.
  4. Run green.
  5. Put the mutation diff, the failing assertion and the restore in the handoff. List "replay passes at base" under Known qualifications.
- **Upstream behaviour.** Where the guarded behaviour lives in an upstream package, nothing under `node_modules/` is ever edited. The accepted alternative evidence is a temporary edit to an mdpro-owned composition file that registers an overriding handler for that node or mark. That edit is a tracked file, so the receipt replays.

### Escalation, ledger and findings
- **Who decides.** Auditors check expected bytes against rationales and tags. Classification questions go through the delegator to the user. Until the user rules, the case carries `limitRef: pending`, and the manifest test fails, so the PR cannot land.
- **Ledger.** MIG-001 changes no feature-ledger row, with one exception: a category PR whose known limitation proves a `Shipped` row false rewrites that row to `Partial` with `限制：` in the same commit.
- **Category l** covers emoji (surrogate pairs, ZWJ, skin tones), CJK, combining marks, and a leading U+FEFF. That last one is a candidate known limitation and a finding: the UTF-8 BOM is not stripped. CRLF and UTF-16 are cited through `externalEvidence`.
- **Category m** uses guard-only records (§ Guard-only records) built from committed recipes with a sha256. Each of the three thresholds (structure count, line length, Source table rows) is tested at threshold−1, threshold and threshold+1, under each view mode where the predicate applies. Long-line and deep-nesting cases mount only at sizes under 2 s.

### Required topics per category
Each ticket maps every topic to at least one case-id.

| Cat | Required topics (at least) | Derived from |
|---|---|---|
| a | 0/1/2/3+ blank lines between blocks; leading and trailing blanks; whitespace-only lines; empty paragraphs around headings, lists, quotes and code; adjacent same-kind lists separated by blanks (ADR-0091 C7); an edit next to an empty paragraph keeps it; undo of that edit restores bytes and `selection` | D188 read/write/stability (A–G), ADR-0091 |
| b | inline `<br>` spellings; two-space and backslash hard breaks; `<br>` inside table cells; legacy `<br />` paragraphs; inline HTML spans kept verbatim | D192 R1–R5/G1–G3, D188 D/E |
| c | full, collapsed and shortcut references; definitions with titles; unused definitions; undefined references; definitions between blocks; inlining (D197) | D194 R1–R14/S1–S5, ADR-0094 |
| d | tight and loose lists; nesting; `-`/`*`/`+` markers; `.`/`)` ordered lists; start numbers including 0 and overflow; task lists; list after a paragraph; `setListKind` bullet↔ordered keeping nesting and spacing, then undo | D195, D204, D208, D226, D318, ADR-0099 |
| e | aligned columns; empty header row; empty cells; ragged rows; escaped pipes; inline marks in cells; long tables; row and column insertion on each side | D64, D100, D103, D108, D135, table-empty-cell-serialize, ADR-0067 |
| f | HTML table paste; mixed slice into a table; paste into a multi-cell range; rowspan/colspan; paste outside a table; refused paste leaving the bytes and `selection` unchanged | D83, D90, D94, D99, D102, D136, D142, D149/D150, D162 |
| g | strong, emphasis, code and strike; `==highlight==`; `<u>` pairs; nested marks; mark boundaries at whitespace (entities); toggling on and off; `clearFormat` then undo | wysiwyg-highlight, D255-wi3b underline/commands, D261 |
| h | fenced and indented code with info strings; block quotes; ATX and setext headings; thematic breaks; HTML blocks; math `$…$` and `$$…$$` literal, with `renderedMath.count = 0` | m1b blocks/quote, milkdownProbe, D188 B6/B9, ledger math `Absent` |
| i | relative, absolute and URL paths; spaces and CJK in paths; titles; the `{mdpro-width=N%}` marker; reference images; `imageSources` resolution of local vs URL vs unresolved | image-path-utils, D255-wi3b image, milkdown-image-resize, useMilkdownImages |
| j | `activateLink` (production origin) on refused schemes with their `reason`; a protocol-relative `//host/x` and a backslash `\\host/x` href, which only the scheme gate refuses; external URLs; relative and fragment links with outcome `same-app` and zero opener calls; an anchor without `href` (`no-href`); autolinks; pasted `<script>` and event handlers (`pasteSafety`); sanitizer order relative to table paste | milkdown-link-click-guard, wysiwyg-security, D235, ADR-0002 |
| k | footnote references and definitions round-trip; multi-paragraph definitions; unused definitions | D194 R14, ledger footnotes `Partial` |
| l | emoji including ZWJ and skin tones; CJK punctuation and full-width spaces; combining marks; a leading U+FEFF; an anchor on a ZWJ string; CRLF and UTF-16 cited externally | cjk-slug, d188 F3-crlf, Rust `file.rs`/`encoding.rs` tests |
| m | each guard threshold at −1/=/+1 under each applicable mode; a long single line and deep nesting under 2 s | large-document-guard tests, ledger rows 86/256 |
| n | `toc` of mixed heading levels including CJK and duplicates; `find` with the case and whole-word options; `replace` one and all, with the resulting bytes and undo | toc-*, d255-wi3c find/replace |

**Consumers, per ticket** (from #702):
- MIG-002 a needs l;
- b needs g, h, n;
- c needs a only;
- d needs l;
- e needs l and n;
- f needs b and j;
- g needs e and f;
- h needs l;
- every MIG-002 row also needs a, and MIG-002b also owns the scroll-anchor card.

So: category b serves MIG-002 f; e serves g; f serves g; g serves b; h serves b; j serves f; l serves a, d, e and h; n serves b and e. MIG-009a selects by id.

## Testing Decisions

**What makes a good test here.**
- A corpus case asserts external behaviour only: the bytes the editor writes, its tag's mechanical rule, and a Markdown-source or rendered-text observation. It never asserts engine internals, store internals or plugin order.
- A case is good when its rationale explains its expected output, its tag rule holds, its declarative negative fails for that case's specific loss, and a mutation receipt shows the guarded code is wired in.

**Seams**, as approved by the user:
1. **The engine-driver interface** (new). The runner, comparator and every action and observation are tested through it, against the real `<MilkdownEditor/>`.
2. **The Tauri module mock** (existing seam), extended with the native opener. It is tested through its logs: a save records exact bytes, an unedited open records no write, and an activated external link records one opener call.
3. **The `corpus:check` command line** (existing pattern). A tooling test runs it against a small valid manifest and against manifests broken one rule at a time, and asserts each named failure. Determinism is tested through an injection seam (two prepared scratch outputs), without nesting Vitest.

**What slice a tests.** Slice a tests its own pieces:
- the comparator and each tag rule;
- the reference transforms;
- each action, including the anchor-error cases: duplicate text, text split across marks, a ZWJ string, a multi-cell range and a missing anchor;
- each observation;
- the checker and the manifest test;
- the fake boundary;
- the write-mode refusal on CI;
- category a's cases.

Every later slice adds data, declarative negatives and receipts only.

**RED evidence.** One declarative negative per fidelity claim, and one temporary-mutation receipt per distinct guarded path, following the procedure above.

**Prior art:**
- `tests/helpers/milkdownEditorHarness.tsx` and `tests/support/d188EmptyParagraphRig.tsx`: a real editor mount, serialize, save;
- the D188, D192 and D194 stability suites;
- the `milkdown-link-click-guard` tests: cancelable clicks and opener calls;
- `scripts/perf/generate-corpus.mjs --check`: recipe and checksum generation;
- `tests/render-fixtures/*.json`: data-driven Markdown cases;
- the convention of setting `navigator.platform` before imports.

## Out of Scope

- Save, close, draft, MCP, IME and multi-window journeys, and the scroll-anchor Mac device card: MIG-002 (#702), with the card in MIG-002b.
- Windows key, AltGr, IME and window routing: WIN-001's capability matrix.
- CRLF and UTF-16 conversion: tested in Rust, cited here.
- Fixing any recorded behaviour: known limitations become D-items through the delegator.
- A Tiptap driver, the editor port, and the A/B experiment (MIG-005, MIG-009a).
- Real WebKit and WKWebView runs: MIG-003's advisory lane.
- Any new CI job, any `ci-gate` change, and any ledger change beyond the stated exception.
- Math rendering in WYSIWYG.
- Rewriting or moving existing D-item tests.

## Further Notes

- **Plan text this spec overrides (named):**
  - §5 item 1: D203, D214 and IME move to MIG-002.
  - §5 item 2: "extract" becomes hand-written inputs.
  - §5 item 3: the three groups become the action groups.
  - §5 item 4: the sample list becomes categories a…n.
  - §5 item 6: "one frozen SHA" becomes per-case merge-base SHAs, beside the shared M0 reference SHA.
  - r1's D8 (improvement never auto-accepted, no either-side pass) is reversed to follow #681 item 4.
  - r1's D19 path becomes rule-10 placement.
  - r1's scroll-anchor observation moves to MIG-002b.
  - r3 removes `activateLink`'s `modifier` (r2 had `none | meta`; the guard has no modifier branch).
- **Known qualification:** a characterization receipt's replay at base passes by construction (#681 item 6(i)).
- **jsdom only:** the corpus characterizes jsdom, not WKWebView.
- **Findings for the delegator:**
  - D-items for undefined-reference escaping and strong-boundary entities, if none exist (inlining is D197; list merging is ADR-0091 C7);
  - the unstripped UTF-8 BOM;
  - MIG-002a needs MIG-001a **and** l.
- **Gate sensitivity and ADRs.** This adds no new job and no `ci-gate` change. The manifest-validation test is an ordinary test in the existing shards, and the delegator classifies it. No ADR is needed.
- **Status:** not granted; implementation is paused (user: 「暂停所有的implement，接下来专注于restructure」). `ready-for-agent` is not a grant (rule 12).
- **Revision r2** closes the merged plan review (MH1–MH4, MM1–MM10, L1–L9). The map from each finding to the text that closes it is kept beside the snapshot.

