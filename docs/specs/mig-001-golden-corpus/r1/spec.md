Part of #697 (MIG-001 row). Plan: `docs/plans/20261107-mdpro_tiptap_windows_plan_v1-3.md` §5 MIG-001, §15 row MIG-001a…n. Decisions: #681 (user: "all yes"); grill record `MIG001-r1-D1`…`D29` and `D9b` (user: 「全部 yes」). Tier High; gated (rule 12); no ADR; no device AC. Snapshot: `docs/specs/mig-001-golden-corpus/r1/`.

## Problem Statement

mdpro is about to replace its WYSIWYG engine, Milkdown, with Tiptap. What Milkdown does to a user's Markdown today is spread across about sixty D-item tests. Each test was written for one defect and builds its own editor, and several of those editors leave out production plugins (tables, paste, find, edit sync). Nothing in the repo answers, in one place and engine-neutrally, "for this exact input, what bytes does mdpro write today, and which of those changes did we accept on purpose?"

Without that answer, a migration can only be judged against itself:
- A Tiptap output that differs from today's can't be told apart as an improvement, an accepted normalization or a regression.
- The tempting "check" (open a file, don't edit it, see that the disk didn't change) proves nothing. mdpro never re-serializes an unedited document, so that check passes on any engine.
- A characterization test is green from its first run, so without failure evidence nobody can show it would catch a loss.

The consumers are waiting on this:
- MIG-002 (#702) needs case-ids to cite for every state-safety journey.
- MIG-009a (#695) needs a corpus subset to run the engine experiment on.
- Every later Tiptap PR needs a byte-level baseline.

## Solution

A **Golden Corpus**: hand-written Markdown fixtures, each with the outputs today's editor produces, a one-line reviewed rationale, and an explicit promise.

- **Each case promises one of three things, its fidelity tag:**
  - the bytes don't change (`immutable`);
  - the meaning is kept, within a closed and cited list of **normalizations** (`semantic-roundtrip`);
  - today's output loses something, and the case records the defect (`known-limitation`).
- **Each case also states what it does to the input, its action group:** nothing (`no-edit`), a scripted edit (`edited`), or an interaction such as paste, find or a table of contents (`interaction`).
- **Engine-neutral by construction.** Cases reach the editor only through a narrow **engine driver**. This spec ships the Milkdown driver, which mounts the real editor with the full production plugin list. A Tiptap driver later runs the same cases against the same expected files, and nothing in the cases changes.
- **Every fidelity claim carries failure evidence:**
  - a committed **negative case**, which hands the comparison a deliberately wrong output and must fail;
  - a **temporary-mutation receipt**, which breaks the guarded production code once and records the case going red.
- **Delivery is fourteen slices, one PR per category:** a (empty paragraphs, plus the tool, driver, comparator, checker and fake Tauri boundary), then b…n in parallel.

## User Stories

1. As the user, I want a single place that says what mdpro writes for each Markdown construct today, so that I can judge the Tiptap migration against my real files rather than against itself.
2. As the user, I want every accepted rewrite of my Markdown listed by name with its source, so that I approve each one knowingly and nothing new slips in.
3. As the user, I want each current defect recorded as a known limitation with the output I'd actually want, so that the migration neither hides it nor gets credit for keeping it.
4. As the user, I want to rule on every classification question (an accepted rewrite or a defect), so that the policy stays mine.
5. As the user, I want adding a fidelity tag, a normalization or an action kind to need my approval, so that the closed lists stay closed.
6. As the user, I want all fourteen categories kept and none dropped without me, so that coverage matches what I agreed in #681.
7. As an implementor, I want one harness that mounts the real `<MilkdownEditor/>` with the production plugins, so that I characterize the app and not a reduced rig.
8. As an implementor, I want to write an input `.md` file, a manifest record and a rationale, and have the generator write the expected outputs, so that adding a case is cheap and mechanical.
9. As an implementor, I want each input to cite the existing test it was copied from, so that reviewers can trace it and the existing test stays unchanged.
10. As an implementor, I want a fixed action vocabulary with text anchors, so that my edited cases mean the same thing on any engine.
11. As an implementor, I want the platform set at the top of a per-platform runner file, as the repo already does, so that platform-dependent modules see the right platform at import time.
12. As an implementor, I want deterministic generation (fake timers, mocked logging, stable ids), so that the expected files never churn between runs.
13. As an implementor, I want `corpus:check` to tell me which rule a manifest breaks, so that I fix structure errors before review.
14. As an implementor of a parallel category, I want my category's manifest in its own file, so that my PR doesn't conflict with the other twelve.
15. As an implementor, when I meet an output that is neither a listed normalization nor a known defect, I want a defined holding state (`known-limitation`, `dId: pending`) and an escalation path, so that I keep working while the user decides.
16. As an implementor of category m, I want huge inputs built at test time from a recipe with a checksum, so that the repo doesn't carry megabytes of fixtures.
17. As an implementor, I want the shard time my category adds reported in my handoff, so that the CI budget stays visible.
18. As an auditor, I want every case to carry a rationale saying why its expected output is right, so that "reviewed per case" is something I can check.
19. As an auditor, I want a negative case for every fidelity claim and a mutation receipt for every guarded path, so that I can see each case is wired to the code it claims to protect.
20. As an auditor, I want each case's untouched output checked separately from its serialized output, so that "the disk didn't change" is never taken as proof of a faithful round-trip.
21. As an auditor, I want a regeneration that changes bytes to show the case's diff and name the commit that caused it, so that drift is never silent.
22. As an auditor, I want the corpus to say it characterizes jsdom and not WKWebView, so that I don't over-read a green run.
23. As the delegator, I want each category to be one ticket and one PR, with a blocking b…n, so that grants and landings stay simple.
24. As the delegator, I want findings (D-items for the known limitations, the UTF-8 BOM) handed to me, so that I open the issues and the corpus never fixes behaviour itself.
25. As the delegator, I want no new CI job and the byte comparison in the existing shards, so that this spec is not gate-sensitive.
26. As the MIG-002 author, I want stable, never-reused case-ids and a `consumers` field, so that my journeys can cite cases that won't move.
27. As the MIG-002 author, I want the fake Tauri boundary (an in-memory file system plus a byte-level write log) to land in slice a as a shared helper, so that my App journeys reuse it instead of growing a second one.
28. As the MIG-009a experimenter, I want to select cases by id and run them through a different driver, so that I compare engines on identical inputs and expectations.
29. As a future Tiptap driver author, I want the driver interface to depend on nothing engine-specific, and observations expressed in Markdown-source terms, so that I implement five methods and change no case.
30. As a D-item fixer, I want to update the case my fix resolves (bytes, tag, rationale citing the fix) without a new user question, so that fixing a defect isn't blocked by the corpus.
31. As a maintainer, I want retired cases kept and marked rather than deleted, so that old citations still resolve.
32. As a maintainer, I want a known limitation that proves a `Shipped` ledger row false to rewrite that row in the same commit, so that the ledger stays true.
33. As a maintainer, I want CRLF and UTF-16 behaviour cited from the existing Rust tests rather than re-tested in Vitest, so that each behaviour is tested once, at its own boundary.
34. As a maintainer, I want math recorded as literal text in WYSIWYG, so that the corpus doesn't widen math scope beyond the ledger's `Absent`.

## Implementation Decisions

**Vocabulary and identity**
- **Action group** (`no-edit | edited | interaction`) is a directory: fixtures live under `tests/fixtures/markdown-corpus/<action-group>/<category>/`. **Fidelity tag** (`immutable | semantic-roundtrip | known-limitation`) is a manifest field and never a directory (D1).
- **The fourteen categories are kept unmerged**: a empty paragraphs; b inline HTML, `<br>` and hard breaks; c reference link definitions; d lists; e GFM tables; f table paste; g marks; h blocks (math as literal text); i images; j link and paste safety; k footnotes; l emoji, CJK and what reaches the editor of line endings and encodings; m extreme input and the large-document guard; n TOC, find/replace and scroll anchor (D2).
- **Case-ids** are `<letter>-<kebab-slug>`, unique across the corpus, never renamed or reused. A case that is no longer wanted is set to `retired` (D3).

**Manifest**
- **Sharding:** one shard per category, `manifest/<letter>.json`, merged in memory by the runner. The closed lists (fidelity tags, normalizations, action kinds, observation kinds) live in `manifest/_lists.json`. Only slice a or a user-approved change may edit that file (D18).
- **Record shape** (D4, D10):
  - `caseId`, `category`, `actionGroup`, `fidelityTag`, `status` (`active | retired`);
  - `input`, a path;
  - `expected: { serialized?, observation? }`, paths, where `observation` is required for interaction cases and `serialized` whenever the document text is produced;
  - `action`, for edited and interaction cases;
  - `platform` (`any | mac | win`);
  - `baselineSha`, the commit the case was generated and reviewed at;
  - `normalizations[]`, ids from the closed list;
  - for `known-limitation`: `dId` (a D-id, an issue, or `pending`), `desired` and `reason`;
  - `guardedPaths[]`, each with its mutation receipt id;
  - `negativeCase`, a test id;
  - `consumers[]`, e.g. `MIG-002b`;
  - `derivedFrom`, `<test file>#<case id>`;
  - `externalEvidence[]`, for behaviour tested at another boundary;
  - `rationale`, one line, required on every case.

**Two outputs per case** (D10)
- **Untouched output:** the stored text after mount, a mode switch and a save with no edit, read from the fake boundary's write log (or the absence of a write). It must equal the input byte-for-byte. It is always treated as immutable and has no tag of its own.
- **Serialized output:** what the serializer produces for the loaded document, or for the document after the case's action. This is exactly what any edit would write.
- The fidelity tag governs the serialized output and the observation only.

**Normalizations, r1 closed list** (D12). Each entry cites its source:
- N1: a two-space hard break is written as a backslash.
- N2: b blank lines read as ⌊(b−1)/2⌋ empty paragraphs, and whitespace-only lines count as blank (ADR-0091).
- N3: leading and trailing empty paragraphs are stripped.
- N4: a trailing newline is added.
- N5: a legacy `<br />`-only paragraph becomes blank lines.
- N6: a missing list marker defaults to `-` / `.` (ADR-0099).
- N7: the table delimiter row is rewritten and cells are padded (ADR-0067).
- N8: a ragged table is widened with blank cells (ADR-0067).

Three current behaviours are `known-limitation`, **not** normalizations, because they change what the user wrote:
- a reference link is inlined;
- an undefined reference is escaped;
- strong-emphasis boundary characters are written as entities.

The delegator opens a D-item for any of these that has none.

**Engine driver** (D9, D9b)
- The corpus has two layers. The engine-neutral layer holds fixtures, manifest, expected files, comparator and runner. The engine driver offers exactly: `mount(input, platform)`, `untouched()`, `serialize()`, `runAction(action)`, `observe(kind)`.
- The runner picks a driver by the environment variable `CORPUS_ENGINE` (default `milkdown`).
- This spec ships only the Milkdown driver. It mounts the real `<MilkdownEditor/>` with the production plugin list, and fakes only the Tauri boundary.
- No corpus case uses the reduced rigs (the scripted rig, the parity editor, or ad-hoc builders).
- The driver does not depend on the editor port (`src/services/editor/`, MIG-005).

**Actions and observations** (D20, D21, D15)
- **Actions are a closed vocabulary**, finalized in slice a: `type`, `delete`, `toggleMark`, `paste` (HTML or plain), `undo`, `insertTableRow`, `insertTableColumn`, `find`, `replace`, `modeSwitch`. Positions are text anchors `{ after | before | select: text, occurrence }`, never engine positions. A category that needs a new kind adds it with the user's approval.
- **Observations use Markdown-source terms only:** heading id and text, source line, matched text and occurrence, and the elements the sanitizer removed. There are no engine node names and no positions.
- One observation schema per kind:
  - `toc`: ordered entries of `{ level, text, id }`;
  - `find`: `{ query, options, matches: [{ text, occurrence, line }] }`;
  - `scrollAnchor`: `{ headingId | line, offsetInBlock }`, in source characters;
  - `pasteSanitize`: `{ removed: [{ element, attribute? }] }`;
  - `largeDocGuard`: `{ mode: "wysiwyg" | "source", reason }`.
- **Interaction outputs:** an interaction case writes `expected.json`. When its action changes the document, it also writes `expected.md`.

**Generator and checker** (D13, D14, D24)
- **Inputs** are hand-written `.md` files copied from the cited test's literal. The existing D-tests stay unchanged. This overrides plan §5 item 2's "extract".
- **`pnpm corpus:generate`** runs the corpus runners with `CORPUS_WRITE=1` and writes the expected files and the generated manifest fields (`baselineSha`). It never writes an input or a rationale.
- **`pnpm corpus:check`** validates the manifests only:
  - every fixture file is listed, and every listed file exists;
  - ids are unique and match the format;
  - tags, normalization ids, action kinds and observation kinds come from the closed lists;
  - every `known-limitation` has `dId`, `desired` and `reason`;
  - every fidelity claim names a `negativeCase`;
  - every case has a rationale and a `baselineSha`;
  - shards are written in canonical key order;
  - two consecutive `CORPUS_WRITE` runs produce identical bytes.
- **Determinism:** fake timers, mocked logging, and no time-, random- or counter-derived ids in any output.
- **Byte comparison** happens in the normal Vitest run, in the existing four shards. There is no new CI job.

**Runner layout** (D19, D17)
- There is one runner file per category per platform present: `tests/markdown-corpus/<letter>-<category>.<any|mac|win>.test.tsx`. Each sets `navigator.platform` before any import, following the existing convention; `any` runs under the mac setting.
- **Platform is an injected input, never `skipIf`.** A case that jsdom cannot simulate does not belong here (D7).
- Each category's handoff reports the time it adds to its shard.

**Fake Tauri boundary** (D29)
- Slice a lands a shared helper. It mocks `@tauri-apps/api/{core,event,window}` with an in-memory file system and a write log that records the bytes of every `save_file`, `save_draft` and `delete_draft`.
- MIG-002's App-journey harness reuses it. This makes MIG-002 a depend on MIG-001 a.

**Baseline and regeneration** (D6, D8, D27)
- Each case records its own `baselineSha`. A regeneration that changes a case's bytes must appear as that case's diff in the PR, with a new rationale that names the causing commit. The Vitest run fails on any unreviewed drift.
- "The M0 baseline" means the corpus as of the last category PR.
- **Improving a known limitation** is an explicit, reviewed manifest change and is never auto-accepted. A D-item fix that resolves one updates the case itself: its bytes, its tag, and a rationale citing the fix.

**Category l** (D11)
- It covers emoji (surrogate pairs, ZWJ sequences), CJK, combining marks, and the editor's handling of a leading U+FEFF. The UTF-8 BOM is detected but not stripped in Rust, so this last case is a candidate known limitation and a finding for the delegator.
- CRLF and UTF-16 are cited through `externalEvidence` to the Rust tests, and are not re-tested.

**Category m** (D16)
- Inputs at the guard thresholds (25,000 structures, 1,000,000-unit lines, 50,000 Source table rows) are built at test time from committed recipes, with a sha256 check.
- The expected output is a `largeDocGuard` observation. Any case slower than about 5 s goes to the existing `*.slow.test` lane.

**Escalation and classification** (D22)
- **Expected-bytes correctness:** auditors check it against each rationale.
- **"Normalization or defect?":** these questions go in the handoff to the delegator, and from there to the user. Until the user rules, the case is `known-limitation` with `dId: pending`, and a PR with a pending case does not land.

**Ledger** (D26)
- MIG-001 adds no user-visible behaviour and changes no ledger row.
- The one exception: a category PR whose known limitation proves a `Shipped` row false rewrites that row to `Partial` with `限制：` in the same commit, and re-runs `ledger:check` and `ledger:build`.

**Required topics per category** (D23). Each ticket maps every topic to at least one case-id.

| Cat | Required topics (at least) | Derived from |
|---|---|---|
| a | 0/1/2/3+ blank lines between blocks; leading and trailing blanks; whitespace-only lines; empty paragraphs around headings, lists, quotes and code; edit-adjacent empty paragraph survives | D188 read/write/stability (A–G), ADR-0091 |
| b | inline `<br>` spellings; two-space and backslash hard breaks; `<br>` inside table cells; legacy `<br />` paragraphs; inline HTML spans kept verbatim | D192 R1–R5/G1–G3, D188 D/E |
| c | full, collapsed and shortcut references; definitions with titles; unused definitions; undefined references (known-limitation); definitions between blocks | D194 R1–R14/S1–S5, ADR-0094 |
| d | tight and loose lists; nested lists; `-`/`*`/`+` markers; `.`/`)` ordered; start numbers incl. 0 and overflow; task lists; list after paragraph | D195, D204, D208, D226, ADR-0099 |
| e | aligned columns; empty header row; empty cells; ragged rows; escaped pipes; inline marks in cells; long tables; row/column insert | D64, D100, D103, D108, D135, table-empty-cell-serialize, ADR-0067 |
| f | HTML table paste; mixed slice in a table; paste with rowspan/colspan; paste outside a table; refused paste | D83, D90, D94, D99, D102, D136, D142, D149/D150, D162 |
| g | strong, emphasis, code, strike; `==highlight==`; `<u>` pairs; nested marks; mark boundaries at whitespace (known-limitation entities); toggle on and off | wysiwyg-highlight, D255-wi3b underline/commands, D261 |
| h | fenced and indented code, info strings; block quotes; headings ATX/setext; thematic breaks; math `$…$` and `$$…$$` as literal text; HTML blocks | m1b blocks/quote, milkdownProbe, D188 B6/B9, ledger math `Absent` |
| i | relative, absolute and URL paths; spaces and CJK in paths; titles; `{mdpro-width=N%}` marker; reference images | image-path-utils, D255-wi3b image, milkdown-image-resize |
| j | `javascript:` and other refused links; autolinks; paste of `<script>`/event handlers; sanitizer order with tables | wysiwyg-security, milkdown-link-click-guard, D235, ADR-0002 |
| k | footnote references and definitions round-trip; multi-paragraph definitions; unused definitions | D194 R14, ledger footnotes `Partial` |
| l | emoji incl. ZWJ and skin tones; CJK punctuation and full-width spaces; combining marks; leading U+FEFF; CRLF/UTF-16 cited externally | cjk-slug, d188 F3-crlf, Rust `file.rs`/`encoding.rs` tests |
| m | each guard threshold just below and just above; very long single line; deep nesting | large-document-guard tests, ledger rows 86/256 |
| n | TOC from mixed heading levels incl. CJK and duplicates; find with case/word options and replace; scroll anchor across mode switch | toc-*, d255-wi3c find/replace, scroll-anchor-* |

**Consumers named per ticket:** MIG-002 (#702) a←l · b←g,h,n · c←(a only) · d←l · e←l,n · f←b,j · g←e,f · h←l; every MIG-002 row also needs a. MIG-009a selects by id.

## Testing Decisions

**What makes a good test here.**
- A corpus case asserts external behaviour only: the bytes the editor would write and the Markdown-source observation. It never asserts engine internals, store internals or plugin order.
- A case is good when:
  - its rationale says why the expected output is right;
  - a committed negative case shows the comparison fails on the specific loss the case claims to catch;
  - a mutation receipt shows that breaking the guarded code turns the case red.

**Seams** (approved by the user):
1. **The engine driver interface**, the only new seam. The runner and comparator are tested through it, against the real `<MilkdownEditor/>`.
2. **The Tauri module mock**, an existing seam. The fake boundary is tested by its write log: a save records exact bytes, and an unedited open records no write.
3. **The `corpus:check` command line**, an existing pattern. A tooling test runs it over a small valid manifest and a set of manifests broken one rule at a time, and asserts the named failure for each.

**What is tested**
- Slice a tests the comparator, runner, driver, checker and fake boundary themselves, as well as category a's cases.
- Every later slice adds cases, negative cases and receipts only.

**RED evidence** (D5, D28)
- Characterization cases are green at first.
- Every fidelity claim has one committed negative case.
- Every distinct guarded path has one temporary-mutation receipt, which may cover several cases. Receipts go in the jack-tdd-workflow receipt store, with ids prefixed `MIG001-<letter>-`.
- A case with no mdpro guarded path names the upstream serializer as its path.

**Prior art**
- `tests/helpers/milkdownEditorHarness.tsx` and `tests/support/d188EmptyParagraphRig.tsx` (real editor mount, serialize, save through a held invoke).
- The D188, D192 and D194 stability suites (untouched open → save).
- `scripts/perf/generate-corpus.mjs --check` and `scripts/manual-fixtures/generate-large.mjs --check` (recipe plus checksum generators).
- `tests/render-fixtures/*.json` (data-driven Markdown cases).
- The `navigator.platform`-before-import convention in the m1b `*-mac`/`*-offmac` tests.

## Out of Scope

- Save, close, draft, MCP, IME and multi-window journeys: MIG-002 (#702).
- Windows key, AltGr, IME and window routing: WIN-001's capability matrix.
- CRLF and UTF-16 conversion, which are tested in Rust and only cited here.
- Fixing any behaviour the corpus records. Known limitations become D-items through the delegator.
- A Tiptap driver, the editor port, and the A/B experiment (MIG-005, MIG-009a).
- Real WebKit/WKWebView runs, which belong to MIG-003's advisory lane.
- Any new CI job, any change to `ci-gate`, and any feature-ledger change beyond D26's exception.
- Math rendering in WYSIWYG. Math stays literal text, per ledger `Absent`.
- Rewriting or moving the existing D-item tests.

## Further Notes

- **Plan drift this spec overrides:**
  - §5 item 1's D203, D214 and IME sources move to MIG-002.
  - Item 2's "extract" becomes hand-written inputs (D13).
  - Item 3's three groups become the action groups (D1).
  - Item 4's sample list becomes categories a…n.
- **jsdom only:** the corpus characterizes jsdom, not WKWebView (D25).
- **Findings for the delegator:**
  - D-items for the three known limitations in N-list r1, where none exist;
  - the unstripped UTF-8 BOM;
  - the MIG-002 a → MIG-001 a dependency (D29).
- **Gate sensitivity and ADRs:** not gate-sensitive, since there is no new job or gate input and the slow lane already exists. No ADR: these are test-internal conventions, outside CLAUDE.md § ADR's list.
- **Status:** not granted; implementation is paused (user: 「暂停所有的implement，接下来专注于restructure」). `ready-for-agent` is not a grant (rule 12).

