# Plan: semantic find ("find with a hunch"), on top of regular find

**Status:** revised after a Codex plan review (§ 11). No code written. Target **v0.3.7**, alongside
Plan P Stage 4. Implementation starts only after v0.3.6's regular find / replace has landed
(§ 3.3).
**Base:** written on `master` @ `33aa6983`.
**Asked by the user** (2026-10-16, relayed by mdpro-delegator): 「v0.3.7 功能: Find feature
enhancement, 常规的查找之外，加上augmented semantic search using Jev model, 类似的可以看看
https://github.com/tymscar/hunch/tree/main 这个Chrome 插件的工作机制，这个值得写一个Plan md，但是对应的实现应该是当前常规查找实现之后再添加。这个交给 codex-audit去写」.
**Written by:** mdpro-codex-audit. The hunch facts come from reading its source at `c220c73d`
(2026-09-27); the Jev facts from TypeSafe's docs and press coverage (§ 10).

## 0. Decisions for the user

None of these is decided. Where there is a recommendation, it is marked as a proposal, with the
reason.

| # | Question | Options | Proposal |
|---|---|---|---|
| **S-U1** | **"Jev", and what to build.** Jev is TypeSafe AI's hosted model (`jev-latest`), the one hunch calls. TypeSafe documents no downloadable weights and no local deployment (§ 4.2), so using Jev means sending the document's text to `api.typesafe.ai` on every search. CLAUDE.md § Constraints ("Local files only") rules that out today | **A. Local substitute.** Hunch's *design* (score every block against the query, light up the best, say "not in this document"), with a small on-device model instead of Jev. No network at search time. Quality is lower than Jev's and unmeasured until S0. **B. Defer.** Keep "Jev" as the requirement and build nothing until TypeSafe offers a local option, or until a local model passes S0's gate. **C. Jev in the cloud, opt-in**, with the user's own API key. Needs CLAUDE.md § Constraints changed, a privacy note, a key store and an ADR. **D. A by default, plus C as opt-in** | **A**, as a proposal. It is the one way to ship in v0.3.7 inside today's constraints. The request's 「类似的可以看看…工作机制」 *may* mean "work like hunch" rather than "call TypeSafe", but that is the user's call, not this plan's. A stays conditional on S0 passing its quality gate (§ 6, S0); if it fails, the choice reverts to B, C or D |
| **S-U2** | **Where the model files come from** (A or D). "Model files" means the whole package: weights, tokenizer, config, and for S-U4 A the ONNX Runtime WASM and the worker script (§ 5.6) | **A. Bundled** in the installer. The model files alone add 24–118 MB (§ 5.3); the installer growth is measured in S0. **B. Downloaded once**, on first use, from a pinned URL with a SHA-256 manifest, into `~/.mdpro/models/`. One-time network use, never at search time | Decide on S0's numbers. B keeps the installer small but adds a download path, a failure state and a "needs the network once" message. (A user-supplied model file was considered and dropped: a weights file alone can't say which tokenizer and pooling it needs; § 8) |
| **S-U3** | **Which model** | The candidates are in § 5.3: Chinese-first, multilingual, or smallest | Decide on S0's numbers, measured on the user's own kind of documents, Chinese and English separately |
| **S-U4** | **Where inference runs** | **A. In the webview:** ONNX Runtime Web (WASM) in a Web Worker, via `@huggingface/transformers` or `onnxruntime-web`. **B. In Rust:** the `ort` crate (ONNX Runtime; CoreML on macOS, DirectML or CPU on Windows) or `candle`, behind a Tauri command | Decide on S0, which must include the **minimum supported** macOS 13.1 WebKit (§ 3.4, § 9). A shares code across platforms, but stock ORT Web builds need WASM SIMD, which WebKit gained in Safari 16.4. B avoids that, at the cost of a native dependency in two release builds. **A cannot be chosen without minimum-OS evidence:** either S0 shows the pinned runtime working on macOS 13.1's WebKit, or the user explicitly accepts "semantic find unavailable below macOS X" together with a capability check and its message (the app's minimum stays 13.1) |
| **S-U5** | **The UI**, to be prototyped later (§ 5.9) | A separate key and bar (hunch's way), a mode switch inside v0.3.6's find popup, or semantic results under the literal ones; plus the highlight style | **Not decided here.** Built with `/mattpocock-skills:prototype` (rule 70 § Questions) after v0.3.6's popup exists |
| **S-U6** | **The key** | Hunch uses ⌥F on macOS and Ctrl+Shift+F elsewhere, keeping ⌘F / Ctrl+F for normal find. On macOS ⌥F types a character (ƒ); Ctrl+Shift+F is unassigned in the menu plan's table | Decide with S-U5. The key goes through the menu plan's command table and collision rules (K1–K8) |
| **S-U7** | **The quality bar** | S0 proposes per-language numbers: recall@5 ≥ 0.80, first-hit accuracy ≥ 0.60, false "found" ≤ 10 % on absent topics, false "not found" ≤ 15 % on present ones (§ 6, S0). The user accepts or changes them **before** the final test partition is evaluated | Shown with S0's measured numbers, so the trade-off is concrete |

## 1. Goal

Typing a phrase or a question into find highlights the **blocks** (paragraphs, list items,
headings, table rows) that are *about* it, even when they share no words with the query, ranked
by relevance. When nothing fits, mdpro says so ("not in this document") instead of showing zero
literal matches. This works in both editor modes, on one open document, with no network at
search time.

It sits **beside** regular find, not instead of it. ⌘F / Ctrl+F stays the literal search that
v0.3.6 delivers.

## 2. Non-goals

- **Not a chat or a generator.** Nothing is written into the document. Hunch's own description
  of Jev applies to the substitute too: it scores, it does not generate text.
- **Not cross-document or folder search.** One open document at a time, as find works today.
- **No replace.** Semantic hits are blocks, not exact strings.
- **No cloud by default.** S-U1 C and D are out of scope unless the user picks them.
- **No persisted index in v0.3.7.** Embeddings live in memory (§ 5.7); a disk cache is § 8's question.

## 3. Current state

### 3.1 Find in mdpro today

- **Source mode:** CodeMirror's `search({top:true})` and `searchKeymap`, mounted from
  `src/components/Editor/extensions/search.ts`. The keymap binds ⌘F (open the panel), ⌘G / ⇧⌘G,
  ⇧⌘L, ⌥⌘G and ⌘D (`@codemirror/search` `dist/index.js:1031-1037`). It does **not** bind ⌘H;
  replace is reached inside the panel. (The ledger row `docs/feature-ledger.md:233` says "⌘H 打开替换";
  that is stale and is reported to the delegator separately. In macOS, ⌘H hides the app today.)
- **WYSIWYG mode:** no find of mdpro's own. `search.ts:15` says *"WYSIWYG (Milkdown) mode search is
  out of scope"* (quoted at `docs/feature-ledger.md:538`). On Windows, WebView2's own find bar answers
  Ctrl+F (menu plan U11, still open).

### 3.2 What v0.3.6 delivers

From [`20261015-plan-menu-reorganisation.md`](20261015-plan-menu-reorganisation.md) and D255:

- **D13**: Find ⌘F / Ctrl+F and Replace ⌘H / Ctrl+H are separate items. Source's `Mod-h` is
  bound in **M1b**, once C2 frees ⌘H from Hide.
- **D255-WI-2**: the WYSIWYG find / replace popup is prototyped (U12, still open) and the user
  picks one.
- **D255-WI-3c**: that popup is built for WYSIWYG.
- **M1a / M1b**: the command table and its keys, which a semantic-find command joins.

### 3.3 Dependency

Semantic find reuses v0.3.6's find surface: its popup (or one of S-U5's variants), match
navigation, scroll markers if any, and its command-table entry. **No implementation work item here
starts before D255-WI-3c and M1b have landed on `master`.** S0 (the spike) is throwaway and may
run earlier.

### 3.4 What the app allows

- **CSP:** `connect-src 'self' ipc: http://ipc.localhost` (`src-tauri/tauri.conf.json`), so
  page-initiated `fetch` / XHR / WebSocket to other origins is blocked. That covers the webview
  only. It does **not** govern Rust-side networking, and `img-src` still allows `https:`. So
  "no network at search time" needs its own enforcement and tests (§ 5.6).
- `script-src 'self' 'unsafe-eval'` allows WASM compilation. **WASM SIMD arrived in WebKit with
  Safari 16.4**, so macOS 13.1's original WebKit may not have it, and ORT Web's multithreading
  needs cross-origin isolation, which mdpro does not set. Both are measured in S0 on the minimum
  OS, not only on a current Mac.
- The app has **no Web Worker** today; S-U4 A would add the first.
- **File cap: 10 MiB** (`10 * 1024 * 1024`). Block count is not bounded by it: a valid 10 MiB file
  of 12-character lines has over 700 000 blocks. Budgets and limits follow from that (§ 5.7).
- **Two Markdown parsers:** Source uses `markdown()` from `@codemirror/lang-markdown` with no GFM
  (`src/components/Editor/extensions/markdown.ts`), so a pipe table is a paragraph there.
  Milkdown loads GFM (`MilkdownEditor.tsx:154`). Block extraction must not depend on either (§ 5.2).
- **Async editor state:** Milkdown serialises edits to the store after a 200 ms delay
  (`src/plugins/milkdown/editSync/controller.ts:55`), and a reload keeps the document id while
  replacing the editor generation (`src/stores/milkdownEditorStore.ts:35`). Any async result must
  be checked against those (§ 5.5).

## 4. Comparison

### 4.1 How hunch works (read from its source at `c220c73d`)

| Step | What hunch does | Where |
|---|---|---|
| Open | Its own key (⌥F macOS, Ctrl+Shift+F elsewhere); ⌘F / Ctrl+F stay the browser's find | `README.md` |
| Blocks | Walks the visible DOM. Each block-level element's *own* text is a block, with inline children folded in. A table row is one block, cells joined with ` \| `. Duplicates are dropped, and so is anything under 12 characters. Blocks over 1 500 characters are split at a space. Ids are `B001`… | `src/content/blocks.ts`, `src/shared/questions.ts` |
| Query | At least 3 characters, debounced 300 ms; a new keystroke aborts the request in flight | `src/content.ts` |
| Model call | Chunks of ≤ 60 000 characters and ≤ 200 blocks (`MAX_CHUNK_BLOCKS = 200`; the README says 160, so the README is out of date), up to 4 in parallel, with a 15 s timeout and 5 retries. Each request sends the URL, title and `B001\| text` lines, plus **one yes/no question per block**: *Is block `Bnnn` what a reader searching this page for "<query>" is looking for?*, with written definitions of true and false | `src/background/answer.ts`, `src/shared/questions.ts` |
| Scores | A calibrated probability (`noul`, 0–1) per question. Results draw as each chunk returns | `answer.ts` |
| Rank | Blocks with p ≥ 0.4, sorted by p | `src/content/hits.ts` |
| Show | Each hit's whole element is tinted, with alpha 0.15 + 0.6·(p − 0.4)/0.6. The best hit becomes current and scrolls into view; Enter and Shift+Enter step through. Scrollbar ticks mark every hit. The verdict reads "on this page · 86%" or "not on this page" | `hits.ts`, `content.ts`, `marks.ts` |
| Limits | A 64 k-token context per request, hence the chunking. Page text leaves the machine while the bar is open | `README.md`, `PRIVACY.md` |

Hunch's key idea is the **question shape**: a per-block yes/no judgement, conditioned on the query
and calibrated, so the same threshold means the same thing on every page. That is what lets it
say "not on this page".

### 4.2 Jev

- TypeSafe's "flagship model and the first System One model". It evaluates typed questions against
  a state and returns structured answers, not text (docs.typesafe.ai).
- **Hosted.** TypeSafe documents no downloadable weights and no local deployment, and publishes
  no architecture or size. Pricing is published (docs.typesafe.ai/models), and TypeSafe makes
  latency claims of its own. Neither has been measured for mdpro's use. A private on-prem
  offering isn't ruled out; it just isn't documented.
- Hunch's model id is `jev-latest`, called through `@typesafe-ai/sdk` with the user's key.

### 4.3 Side by side

| | Regular find (v0.3.6) | Hunch | This plan (S-U1 A) |
|---|---|---|---|
| Matches | exact strings | blocks, by meaning | blocks, by meaning |
| Model | — | Jev, in the cloud | small local embedding model (§ 5.3) |
| Network at search time | none | every search | none |
| "Not in this document" | 0 matches | calibrated verdict | only after the whole revision is indexed, with a threshold S0 sets; weaker than Jev's (§ 5.4) |
| Modes | both (after v0.3.6) | web pages | both editor modes |

Whether Typora and VMark have semantic find was not re-checked (§ 9).

## 5. Proposed design (for S-U1 A)

### 5.1 Pipeline

```
open semantic find
  → occurrences = extract(markdown)      one parser for both modes (5.2)
  → index(revision)                      embed unique block texts, progressive (5.5, 5.7)
query (min length per 5.2, debounce, new input cancels)
  → q = embed(query)
  → rank: literal tier first, then semantic (5.4)
  → highlight occurrences, step, verdict (5.9)
every async result → accepted only if its tags still match (5.5)
```

### 5.2 Blocks: one parser, both modes

- **Extraction parses the document's Markdown text once, with the same remark + GFM configuration
  Milkdown uses**, independent of either editor's parser. Each **occurrence** is
  `{ occurrenceId, blockKey, text, kind, sourceRange }`, where kind is a paragraph, a heading, a
  list item (its own paragraph, without nested lists), a table row (cells joined with ` | `), a
  blockquote paragraph, or a code block.
- **Mapping to the editors:** in Source, `sourceRange` *is* the CodeMirror range. In WYSIWYG, the
  occurrence has to be mapped to a ProseMirror position, and **no such mapper exists today**.
  The TOC's `src/utils/tocElementResolution.ts` maps heading keys to DOM elements by sequence
  and text, which is the nearest precedent and not a source ↔ PM mapper. S2 builds one: walk
  the PM document's blocks in order, classify them with the same kinds, and align them with the
  occurrences by sequence and normalised text, giving each occurrence a PM position range.
  **Unmappable policy:** an occurrence that doesn't align is logged (count only) and kept in the
  index; in WYSIWYG it isn't highlighted or stepped to, and the verdict says so ("N related
  blocks · k shown in Source only"). It never makes the verdict "nothing".
- **Duplicates:** identical texts are embedded **once** (by `blockKey`, a hash of the normalised
  text), and every occurrence keeps its own range, so a repeated paragraph highlights everywhere.
- **Minimum lengths are proposals, measured in S0:** hunch's 12-character block minimum and
  3-character query minimum would drop short Chinese headings and a two-character query such as
  「收入」. The proposal: headings are always kept whatever their length; other blocks count CJK
  characters as 2 toward a minimum of 12; the query minimum is 2 for CJK and 3 otherwise.
- **Long blocks** are split by **tokens**, not characters (§ 5.3): windows of the model's limit
  minus prefix and special tokens, with overlap. A block's score is its best window's.

### 5.3 Model candidates (S-U3, measured in S0)

Sentence-embedding models in ONNX form. Sizes are from their Hugging Face file listings
(2026-10-16), and the licences are from the upstream model cards (both MIT, confirmed in review):

| Model | Languages | Output | Pooling | Input limit | int8 ONNX | fp32 ONNX |
|---|---|---|---|---|---|---|
| `BAAI/bge-small-zh-v1.5` (`Xenova/` export) | Chinese-first | 512-d | CLS, normalised | 512 tokens | 23.9 MB | 94.9 MB |
| `intfloat/multilingual-e5-small` (`Xenova/` export) | ~100 languages | 384-d | masked mean, normalised; `query:` / `passage:` prefixes | 512 tokens | 118 MB | 470 MB |
| `paraphrase-multilingual-MiniLM-L12-v2` (`Xenova/` export) | 50+ languages | 384-d | mean | 128 tokens (model default) | 118 MB | 470 MB |

These are model-file sizes. Installer growth also includes the tokenizer and, for S-U4 A, the ORT
WASM build, and is measured in S0.

The **inference contract** is per model, not just `embed(texts[])`: tokenizer, prefixes, pooling,
normalisation and window size are part of the model's manifest (§ 5.6). Two runtimes for the same
model must produce the same vectors within a tolerance on a fixed fixture (an S3 test).

A **cross-encoder** (reranker) is closer to Jev's per-block question. S0 measures one as a second
stage over the embedding top-k (for example 50). It is adopted only if it fits § 5.8's budget.

### 5.4 Ranking and the "not in this document" verdict

- **Two tiers, not a bonus:** a block that contains the literal query (v0.3.6's matcher,
  case-insensitive) is always ranked above any block that doesn't, whatever its similarity. Within
  each tier, blocks are ordered by similarity. This is what "augmented" means: everything literal
  find would show, plus the related blocks.
- **Semantic threshold:** cosine similarity is not a calibrated probability, the way Jev's `noul`
  is. S0 compares a fixed per-model threshold with a relative rule (the top score must clear the
  document's median by a margin) on S0's **validation** partition, and S1 records the winner.
  The final test partition is not used for this choice (§ 6, S0).
- **The verdict depends on coverage:**

  | Index state | Verdict shown |
  |---|---|
  | loading / partial | "Searching… N% indexed", plus the hits so far. Never "not in this document" |
  | complete, hits | "N related blocks" |
  | complete, none above the threshold | "Nothing in this document looks like that" |
  | cancelled / failed | "Semantic search stopped: <reason>". Literal results stay |

- Percentages like hunch's are not shown unless S0 calibrates the score (S-U5, § 8).

### 5.5 Async results: the acceptance contract

Every index or query result carries tags: `documentId`, `editorGeneration`, `editRevision`,
`queryGeneration`, and `modelId`. The controller accepts a result only if every tag still matches
the live state. Otherwise the result is dropped, and a stale result is logged.

**`editRevision` is not the store's state.** In WYSIWYG the store is written up to 200 ms after
an edit (§ 3.4), and the edit-sync controller's own counter is private
(`src/plugins/milkdown/editSync/controller.ts:99`); `Document` has no revision field. So S5 adds
a per-editor counter that advances **synchronously** on every document-changing transaction: a
ProseMirror plugin's `appendTransaction`/view `update` when `tr.docChanged`, and a CodeMirror
`updateListener` when `update.docChanged`. Extraction reads the editor's own Markdown at that
revision, not the store's. S5 tests a completion that arrives **inside** the 200 ms gap after an
edit and expects it to be dropped.

Closing a tab disposes of its index and cancels its work, and a late result can't bring the index
back. That covers:
- an edit;
- a reload;
- an MCP `write_document`;
- a mode switch;
- a tab close;
- an editor rebuild (Milkdown's 200 ms delayed serialisation, § 3.4).

### 5.6 Offline packaging and enforcement

- **A pinned model package:** the weights, `tokenizer.json`, config, the pooling and prefix
  manifest, and for S-U4 A the exact ORT WASM files and the worker script. Every file is listed
  with its SHA-256 in a manifest checked at load time.
- **No remote fallback:** for transformers.js, `env.allowRemoteModels = false` and local paths
  only. The files load through Tauri's `asset:` protocol or IPC; that route is defined in S3,
  and the CSP is updated in the same commit if it needs to be.
- **Enforced and tested across boundaries:** a test fails if the semantic path (main thread,
  worker or Rust command) opens a connection to any non-local origin. That is done with a mocked
  transport at each boundary, not just a main-thread `fetch` spy. The release check proves a cold
  start offline: the network is off, the model loads, and the search works.

### 5.7 Memory and limits

- **Per document:** at most `MAX_SEM_BLOCKS` unique block texts (proposal: 50 000) and
  `MAX_SEM_VECTOR_MB` of vectors (proposal: 128 MB). Past either limit, semantic find indexes the
  first N blocks and says "Too large for semantic search: searched the first N blocks". Literal
  find is unaffected.
- **Across the app:** at most `MAX_SEM_TOTAL_MB` (proposal: 256 MB) of indexes, with least-recently-used
  tabs evicted first. An evicted tab re-indexes when it is searched again.
- **Batches:** embedding runs in bounded batches (for example 64 blocks) with a bounded queue, so
  a 10 MiB document never builds one giant tensor or IPC message.
- Vector size: 512-d × 4 B = 2 KB per block for bge-small-zh, so 50 000 blocks ≈ 100 MB. S0
  measures the real figure, including runtime overhead and worker or IPC copies.

### 5.8 Budgets (targets, measured in S0 on named hardware)

Reference machines: the user's MacBook (Apple Silicon) and the `win-desktop` PC (its CPU is
recorded in S0's record), plus a macOS 13.1 machine or VM for compatibility only. Fixtures are
generated: 100 KB, 1 MiB and 10 MiB mixed Chinese and English, plus a 10 MiB short-line worst
case.

| Measure | From → to | Target |
|---|---|---|
| Model load, cold | first semantic open after app start, OS file cache flushed where possible → model ready | ≤ 4 s Mac, ≤ 8 s PC |
| Model load, warm | second open in the same session → model ready | ≤ 1.5 s Mac, ≤ 3 s PC |
| Index 100 KB | index start → complete | ≤ 2 s; first hits shown before complete |
| Index 1 MiB | index start → complete | ≤ 15 s Mac, ≤ 30 s PC |
| Index 10 MiB | index start → complete or § 5.7 limit reached | ≤ 90 s Mac, ≤ 180 s PC; first hits before complete; cancellable in ≤ 100 ms |
| Query (excluding debounce) | debounce fires → first highlight | ≤ 150 ms with a complete index |
| Query (including debounce) | last keystroke → first highlight | ≤ 450 ms (300 ms debounce + 150 ms) |
| Typing while indexing | keydown → next frame painted | p95 ≤ 32 ms (a probe S0 adds; the D12 harness measures heap, not input latency) |

### 5.9 UI (options for the prototype; not decided)

For `/mattpocock-skills:prototype`, after v0.3.6's popup exists:

1. **A separate bar** with its own key, as in hunch. ⌘F stays literal.
2. **A mode switch inside the find popup** ("Exact" / "Related"), on the same key.
3. **One popup, two result groups:** literal matches, then "Related" blocks.
4. **Highlight style:** a whole-block tint scaled by score (hunch's way), a left-edge bar per
   block, or a tint on the current hit only. Both themes, under the contrast and focus rules in
   `.claude/rules/31` and `33`.
5. **Verdict and progress text:** where it sits and what it says (§ 5.4's states), in English.
6. **Scroll-bar ticks:** reuse v0.3.6's, if its popup has them.
7. **Settings:** an on/off switch for semantic find (on by default only if S-U2 is A), the model
   status and size, and "Remove model" if it was downloaded.

### 5.10 Failure and recovery

- **Disable switch:** Settings turns semantic find off. That unloads the model and frees every
  index; regular find is untouched.
- **Missing or corrupt model package, or a hash mismatch:** the bar says so, semantic find stays
  off for the session, and regular find works.
- **A worker crash, or an out-of-memory error inside the worker:** the worker is restarted
  once. If it fails again, semantic find is off for the session with a message. A Rust task
  error surfaces as the command's `Err`.
- **What is guaranteed, and what isn't:** for the recoverable failures above, the editor and
  the document are unaffected. A **native** failure is not covered: an ONNX Runtime abort or a
  process-level out-of-memory inside mdpro's own process (S-U4 B, or the webview process under
  A) can take mdpro down. The only defences are § 5.7's limits and S0's worst-case memory
  measurement, and S-U4's choice weighs that risk.
- **Removing the model:** cancels in-flight work, unloads the model, then deletes the files. A
  search that starts during removal gets the "missing model" state.
- **Late completions after disable or removal** are dropped by § 5.5's tags (`modelId` is cleared),
  so they can't reload the model or recreate an index. S5 and S8 test both.

### 5.11 Logging (rule 20)

Events: `search.semantic.model.load`, `.model.remove`, `.index`, `.query`, `.cancel`, `.stale`
and `.error`. They follow rule 20's start and outcome pairing, with one `actionId` per operation.
A cancellation ends the original operation with status **`cancel`** (`LogStatus` in
`src/types/logging.ts:3`) on the same `actionId` as its `start`, not as a `fail`.

What they carry: counts, milliseconds, the model id, the index state, and the query's **length**.
Never document text or the query. Each WI that adds a path (S3 load and inference, S5 index and
stale, S6 Settings switch, S8 download and removal) adds its events and two tests: every `start`
ends in exactly one `success`, `fail` or `cancel` with the same `actionId`, and no event carries
document or query text.

## 6. Work items

Each WI gets a branch, `<type>/<id>-<slug>`, in its own `mdpro-wt/` worktree, and the delegator
lands it (rule 70). The receipt prefix is `SEM-WI-*`, unless the delegator names another.

Every behaviour WI runs this sequence (rules 10, 20, 60):
1. **RED**: write the WI's test files (named in the table, all under `tests/`) and run exactly
   those, both extensions included, with `pnpm exec vitest run <the WI's files>`, e.g.
   `pnpm exec vitest run tests/semantic-find-extract.test.ts tests/semantic-find-map.test.tsx`
   (2 workers, no lock). See them fail, then record the red with
   `node "$R" record --id SEM-WI-<n>`, where `$R` is tdd-guardian's
   `${CLAUDE_PLUGIN_ROOT}/scripts/tdd-guardian/receipt.js` as `/tdd-guardian:implement` resolves
   it. Rust test files are `cargo fmt --manifest-path src-tauri/Cargo.toml`-clean first (D187).
2. **GREEN**: implement until the same vitest command (or `cargo test --manifest-path
   src-tauri/Cargo.toml <test name>`) passes, then `node "$R" verify --id SEM-WI-<n>`.
3. **Once, before the commit**, the commit lanes from `.claude/tdd-guardian/config.json`:
   - `scripts/heavy-lock.sh pnpm exec vitest run --coverage` (`unit`);
   - `scripts/heavy-lock.sh sh -c 'pnpm -s typecheck:tests && pnpm -s build'`;
   - only if `src-tauri/` changed:
     `scripts/heavy-lock.sh node scripts/cargo-test-lane.mjs cargo test --manifest-path src-tauri/Cargo.toml` (`rust`),
     the same with `--features verify-run` (`rust-verify-run`),
     `scripts/heavy-lock.sh cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` (`clippy`) and
     `cargo fmt --manifest-path src-tauri/Cargo.toml --check` (`fmt`).
   - A `*.slow.test.ts` sibling, if a WI adds one (ADR-0050), also runs
     `scripts/heavy-lock.sh pnpm exec vitest run --config vitest.slow.config.ts` before handoff.
4. `pnpm ledger:check`, and `pnpm ledger:build` when the ledger changed.
5. In the same commit: `CHANGELOG.md` under `[Unreleased]`, the ledger row, the user guide page
   `docs/guide/semantic-find.md` (created by S6, extended by S7 and S8; rule 20), and, for a new
   IPC command or event, CLAUDE.md's list.
6. The handoff to the delegator names the SHA, the receipt ids and the lanes that passed.

| WI | Scope | Files (expected) | Tests (rule 10) | Ledger / ADR |
|---|---|---|---|---|
| **S0** | **Spike, throwaway; may run before v0.3.6 lands.** Branch `spike/semantic-find`. It measures each § 5.3 model under each S-U4 runtime: WKWebView on the current macOS **and** on 13.1, WebView2 (version recorded), and Rust `ort`. Per combination: load time, ms per batch, peak memory, worker or IPC copy cost, installer growth, and the § 5.8 budgets. **Quality:** a labelled set split **by document** into three partitions: *tune* (prompting, windows, minimum lengths), *validate* (choosing the model, the reranker and § 5.4's threshold rule), and a *final test* partition that nobody looks at until the gate, model, rule and threshold are frozen and the user has approved S-U7. It is then evaluated once, and its numbers are the ones S1 records. Chinese and English are reported separately. Queries include paraphrases, questions, absent topics and negations. Reported: recall@5, first-hit accuracy, false "found" rate (on absent topics) and false "not found" rate (on present ones). One reranker is tried as a second stage. **Proposed gate, per language, on the final test partition:** recall@5 ≥ 0.80, first-hit accuracy ≥ 0.60, false "found" ≤ 10 %, false "not found" ≤ 15 %. These are proposals for S-U7; the user may change them before the final evaluation, not after. Failing the gate sends S-U1 back to the user | spike branch only; the record goes in `docs/test/<date>-sem-s0-spike.md`, fixtures in `tests/manual-fixtures/sem-*.md` and a generator script for the 10 MiB files | none (spike) | none; feeds S-U2 to S-U4 and S-U7 |
| **S1** | **The ADR and the contracts** (ADR number from the delegator when written). It records S-U1 to S-U4 and S-U7 as answered, the model, its licence, how it is delivered, the runtime and the new dependency. It defines the types: `Occurrence`, the model manifest, the request and result tags (§ 5.5), the index states (§ 5.4), and the lifecycle owner, a `semanticFindController` per window. It updates CLAUDE.md § Constraints only if S-U1 is C or D | `docs/adr/NNNN-…md`; `src/features/semanticFind/types.ts` | type-only (no tests, rule 10) | ADR **yes** |
| **S2** | Extraction and mapping (§ 5.2) | `src/features/semanticFind/extract.ts`, `mapToEditor.ts` (or the generalised TOC resolver) | Same Markdown → the same occurrence kinds, texts and grouping in both modes, and each `sourceRange` maps to the right text in each editor. Fixtures: a GFM table (a paragraph to Source's parser, rows here), nested lists, a list item with a nested list, a blockquote, links and images (alt text kept), a repeated paragraph (one key, two occurrences), a short CJK heading, an empty doc, and a 1 500-character CJK paragraph. Mapping: every mappable occurrence's PM range holds its text; a deliberately unalignable block follows the unmappable policy (§ 5.2). Files: `tests/semantic-find-extract.test.ts`, `tests/semantic-find-map.test.tsx` | none |
| **S3** | The inference service under S1: package load with the manifest check, tokenizer-aware windows, pooling and normalisation per the manifest, batches, cancellation, and the worker or the Tauri command. If Rust: the command returns `Result`, validates count and total size, is registered in `commands/mod.rs`, and has its wrapper in `src/services/semanticFindService.ts` (rule 50 § 2) | `src/features/semanticFind/worker.ts` or `src-tauri/src/commands/semantic.rs` + service, `src/services/semanticFindService.ts` | Mocks only at the worker port or `invoke`. Error paths: a missing file, a hash mismatch, a cancel mid-batch, an oversized input, a worker crash with one restart. A fixed fixture gives the same vectors (within a tolerance) from S0's reference output. A relevant sentence at the **end** of a long CJK block is found, because windows cover it. No-network test (§ 5.6). Logging pairs carry no text. Rust: input validation and the error type. Files: `tests/semantic-find-service.test.ts`, `tests/semantic-find-offline.test.ts`, and `#[cfg(test)]` in `semantic.rs` if Rust | a row for the command, if any |
| **S4** | Ranking and index state, pure: the two tiers, the threshold rule from S1, verdict states, limits and LRU (§ 5.7) | `src/features/semanticFind/rank.ts`, `indexState.ts` | A low-similarity literal hit outranks a high-similarity semantic-only one; ordering is deterministic on fixed vectors; there is no "nothing" verdict while the index is partial; "nothing" appears only on complete coverage with everything below the threshold; limit and eviction boundaries are tested just below, at and above each limit. Files: `tests/semantic-find-rank.test.ts`, `tests/semantic-find-index-state.test.ts` (`// @vitest-environment node`) | none |
| **S5** | The controller and lifecycle (§ 5.5): per-window ownership, tags, accepting or dropping results, disposal on tab close, incremental re-index on edit | `src/features/semanticFind/controller.ts` (a `useSemanticFind` hook if needed) | Delayed completions across each transition (edit, reload, MCP write, mode switch, tab close, editor rebuild) are dropped and logged `stale`; a closed index is not revived; a completion inside the 200 ms gap after a WYSIWYG edit is dropped (§ 5.5); a late completion after disable or model removal neither reloads the model nor recreates an index; an edit re-embeds only changed `blockKey`s; two windows don't share or cross results. File: `tests/semantic-find-controller.test.ts` | — |
| **S-P** | **Prototype, throwaway**: § 5.9's options on `prototype/sem-find`, after D255-WI-3c's popup exists; the user picks (S-U5, S-U6) | the prototype branch | none (prototype) | the verdict is committed on the branch; the delegator updates DESIGN.md |
| **S6** | UI as the user picked it: the command in the command table (S-U6's key, through K1–K8), the bar or popup mode, progress, verdict states, stepping, the Settings switch and model status (§ 5.9 item 7) | the find popup's files from v0.3.6, `src/features/semanticFind/SemanticFind*.tsx`, the Settings page | Component tests (ARIA, `userEvent`): open, type, debounce, a stale result cancelled by new input, Enter / Shift+Enter cycling, Escape closes and clears, each verdict state rendered, the switch off unloads (via the controller mock); the key reaches the command once in both modes through the composed keymaps. File: `tests/semantic-find-ui.test.tsx` | a new row "语义查找", `Partial` with `限制：` until S8 |
| **S7** | Highlights and navigation in both editors, in **the style the user picked**: PM decorations in WYSIWYG, CM decorations in Source, the current hit scrolled into view, ticks if v0.3.6 has them | `src/features/semanticFind/decorations.ts` | Decorations follow edits (an edited hit block moves or drops), a mode switch re-maps or closes cleanly, and the dirty flag never changes. File: `tests/semantic-find-decorations.test.ts` (extracted decoration logic, rule 10 § plugins) | — |
| **S8** | Packaging per S-U2 (bundled, or the download with progress, retry, hash check and removal), recovery (§ 5.10), and the cold-start offline release check | the release workflow config, Settings, `src/features/semanticFind/package.ts` | Download (if chosen): a hash mismatch, an interrupted download, and no network each give a clear message, and regular find still works. Removing the model during a search gives the missing-model state. Removal with a completion pending doesn't recreate anything. Installer size is measured in the release build. Offline cold start on both platforms. File: `tests/semantic-find-package.test.ts` | ledger row to `Shipped`, or `Partial` with its limit |

**Order:** S0 (any time) → the user answers S-U1 to S-U4 and S-U7 → S1 → [v0.3.6's D255-WI-3c and
M1b on `master`] → S2, S3 and S4 in parallel against S1's types → S5 → S-P → S6 → S7 → S8.

### 6.1 Device checks

| Platform | How | What | Failure |
|---|---|---|---|
| macOS (current, Apple Silicon) | dtrack brief, batch "find" | Both modes, both themes: S0's held-out queries, where first-hit accuracy and absent-topic rates meet S-U7's gate. A partial index never shows "nothing". ⌘F stays literal. Typing while indexing the 1 MiB fixture meets § 5.8. Offline cold start: the model loads and searches with the network off. `nettop` shows no connection during a search | below the gate; "nothing" shown on a partial index; any outbound connection; typing over budget; the document marked dirty |
| macOS 13.1 | A macOS 13.1 VM or spare machine. If none can be found, S-U4 A stays unselectable (S-U4) unless the user accepted the capability-check route; that acceptance is quoted in the ADR | The runtime S1 chose loads, or the capability check shows its "unsupported on this macOS" message and regular find works. mdpro's OS minimum isn't silently raised | a crash, a silent failure, or no evidence at all for the chosen route |
| Windows | `remote-windows-device-test` skill, CDP page shots | Same queries; the model loads from where S-U2 put it; WebView2's own find doesn't fight the key (U11) | as on macOS |
| Linux | not available | untested (menu plan D6) | — |

## 7. Risks

| Risk | Note |
|---|---|
| Quality below expectation | A 24–118 MB embedding model is weaker than Jev at "does this block answer the question". S0's gate decides; if it fails, S-U1 goes back to the user |
| Calibration | Cosine has no fixed meaning across documents. Mitigated by the coverage rule (§ 5.4) and S0's held-out thresholds; it can still be wrong both ways |
| Installer size | The model files are 24–118 MB if bundled, against current installers of about 7 MB |
| macOS 13.1 WebKit | No SIMD before Safari 16.4, and no threads without cross-origin isolation. This is the main reason S-U4 B exists |
| Memory | Short-line documents and many tabs. Bounded by § 5.7's limits |
| A new native dependency (S-U4 B) | `ort` brings ONNX Runtime per platform and touches both release builds and the ADR-0073 workflow |
| Main-thread jank | Any inference on the main thread is a regression; the worker or Rust task is mandatory |

## 8. Open questions (beyond § 0)

1. **A user-supplied model**, as a later option: it would need a package format (§ 5.6's
   manifest) and an import flow. It is not in v0.3.7.
2. **A disk cache of embeddings:** it writes data derived from the document into `~/.mdpro/`.
   Is that acceptable later?
3. **A percentage display like hunch's:** only if S0 can calibrate the score (§ 5.4).
4. **A headings-only "jump to section by meaning" mode:** not in scope unless asked.

## 9. What this plan could not verify

- **Jev's latency and quality on mdpro's documents:** TypeSafe publishes pricing and its own
  latency claims, but nothing was run, because a run would send text to the cloud. Its
  architecture and size are unpublished.
- **Every number in § 5.7 and § 5.8:** proposals and targets, not measurements.
- **WKWebView on macOS 13.1** (SIMD, threads, ORT Web) and **WebView2's** WASM behaviour inside mdpro.
- **Whether `tocElementResolution.ts` generalises** from headings to every block kind (S2 finds out).
- **Typora and VMark** having no semantic find: not re-checked.
- **v0.3.6's find popup:** U12 is open; § 5.9 assumes only that the popup exists.

## 10. Sources

- hunch: <https://github.com/tymscar/hunch> @ `c220c73d`. Read: `README.md`, `PRIVACY.md`,
  `src/background/answer.ts`, `src/shared/questions.ts`, `src/shared/settings.ts`,
  `src/content.ts`, `src/content/blocks.ts`, `src/content/hits.ts`.
- TypeSafe: <https://docs.typesafe.ai>, <https://docs.typesafe.ai/models>. Press: MarkTechPost,
  "TypeSafe AI Releases Jev" (2026-09-19); "Jev AI Reality Check: Can You Run TypeSafe's Model
  Locally?" (modemguides.com).
- Models: the Hugging Face listings for `Xenova/bge-small-zh-v1.5`, `Xenova/multilingual-e5-small`
  and `Xenova/paraphrase-multilingual-MiniLM-L12-v2`, and the cards for `BAAI/bge-small-zh-v1.5`
  and `intfloat/multilingual-e5-small`.
- WebKit 16.4 release notes (WASM SIMD); ONNX Runtime Web docs (threads need cross-origin
  isolation; deployment artifacts); transformers.js custom usage (`allowRemoteModels`).
- mdpro: `src-tauri/tauri.conf.json`, `src/components/Editor/extensions/search.ts`,
  `extensions/markdown.ts`, `MilkdownEditor.tsx:154`, `src/plugins/milkdown/editSync/controller.ts:55`,
  `src/stores/milkdownEditorStore.ts:35`, `docs/feature-ledger.md:233, 538`, and the menu
  reorganisation plan (D13, U11, U12, D255-WI-2 and 3c, M1a and M1b).

## 11. Review record

- **First draft:** reviewed with `/cc-suite:review-plan` (Codex `gpt-6.1-sol`, effort high,
  `review-plan-mvalqphz-l30pc0`, thread `01a14374-13dd-7392-8089-ab0aa88771ce`). Verdict NEEDS
  REVISION, with 20 findings: Critical 0 · High 7 · Medium 12 · Low 1.
- **This revision:** addresses each of the 20:

| # | Fix |
|---|---|
| 1 | § 3.1: today's keys come from the installed keymap; ⌘H moves to M1b. The stale ledger line is reported |
| 2 | § 5.4: two tiers instead of a bonus; S4's test |
| 3 | S7 uses the style the user picked |
| 4 | § 4.2 and § 9: pricing is published; latency is the vendor's claim |
| 5 | § 5.5: the tag contract; S5 |
| 6 | § 5.4: verdict states; S4 |
| 7 | § 5.2: occurrences survive deduplication; the CJK minimums are proposals |
| 8 | § 5.11: logging, owned by each WI |
| 9 | § 3.4 and § 5.7: limits, eviction, batches; the 512-d vectors |
| 10 | § 5.2 and § 5.3: token windows, pooling, normalisation; S3's tests |
| 11 | S-U4, § 3.4 and S0: 13.1 compatibility; § 6.1 |
| 12 | § 5.6: the package manifest, no remote fallback, tests across boundaries, an offline cold start |
| 13 | § 3.4 and § 5.2: one remark + GFM parser; S2's fixtures |
| 14 | S-U1 gains the defer option and a neutral framing |
| 15 | S0's held-out gate; S-U7; § 6.1 uses the same metric |
| 16 | § 5.8: named hardware, fixtures, the clock boundaries |
| 17 | S-U2 C dropped to § 8 |
| 18 | S1 owns the contracts before the parallel work |
| 19 | Files per WI; the command list in § 6 |
| 20 | § 5.10: recovery, the disable switch, model removal |

- **Second pass:** a scoped confirm (`review-plan-mvam40p2-jnfeui`, thread
  `01a1437d-8c02-7893-a95c-8c8eeb1014ad`) found 12 closed, 8 partial and nothing new: Critical 0 ·
  High 3 · Medium 5 · Low 0. All 8 were then folded in:

| # | Partial gap | Fix |
|---|---|---|
| 5 | The store revision misses edits inside the 200 ms sync gap | § 5.5 adds `editRevision`, a synchronous editor counter, with an S5 test inside the gap |
| 8 | Cancellation status; outcome pairing per WI | § 5.11: `cancel` on the same `actionId`; pairing tests in S3, S5, S6 and S8 |
| 11 | No rule if no 13.1 machine exists | S-U4 and § 6.1: A needs 13.1 evidence, or the user's quoted acceptance of a capability check |
| 13 | The plan claimed an existing source-to-PM mapper | § 5.2: none exists; S2 builds one, with an unmappable policy and its test |
| 15 | Gate numbers were examples; threshold chosen on test data | S0: tune / validate / final-test partitions; four proposed numbers, frozen before the final run |
| 16 | No 10 MiB completion budget; cold load and debounce missing | § 5.8: cold load, 1 MiB and 10 MiB completion, and debounce-inclusive query rows |
| 19 | No test filenames, commands or guide page | § 6's six-step sequence; a file per WI; `docs/guide/semantic-find.md` |
| 20 | The guarantee covered native crashes too | § 5.10 scopes it to recoverable failures; late completions after disable or removal are tested |

- **Third pass:** `review-plan-mvambem1-ueym2n` (thread `01a14382-ce20-76d1-a8ce-cfeee96bfef3`)
  closed 7 of the 8 and left #19 partial (Medium): the RED command missed `.test.tsx` files, the
  receipt and Rust commands were prose, and `clippy` / `fmt` were missing. § 6 step 1–3 now give
  the exact commands from the lane config. Result: Critical 0 · High 0 · Medium 1 · Low 0, and that one Medium is now fixed.
  The weighted minimum still dropped a heading like 「收入」 (noted under #7); § 5.2 now always keeps headings.
- **Recorded where the reviewer could not check:** the reviewer couldn't fetch hunch's source. The
  author read it directly: `MAX_CHUNK_BLOCKS = 200` at `c220c73d`, while the README says 160.
