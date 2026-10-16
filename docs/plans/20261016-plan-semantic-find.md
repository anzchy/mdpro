# Plan: semantic find ("find with a hunch"), on top of regular find

**Status:** revision 3. S-U1 and S-U8 to S-U12 are answered; revised after the user-run full review and re-reviewed with Codex (§ 11). No code written. Target **v0.3.7**, alongside
Plan P Stage 4. Implementation starts only after v0.3.6's regular find / replace has landed
(§ 3.3).
**Base:** `master` @ `9a0aed26` (first written on `33aa6983`).
**Asked by the user** (2026-10-16, relayed by mdpro-delegator): 「v0.3.7 功能: Find feature
enhancement, 常规的查找之外，加上augmented semantic search using Jev model, 类似的可以看看
https://github.com/tymscar/hunch/tree/main 这个Chrome 插件的工作机制，这个值得写一个Plan md，但是对应的实现应该是当前常规查找实现之后再添加。这个交给 codex-audit去写」.
**S-U1 answered by the user** (2026-10-16, relayed by mdpro-delegator), verbatim: 「C Jev in the
cloud, with a small on-device embedding model as backup, search if there is any open-weight jev
related model? and with API key, we need to add configs in Settings -> Integrations」.
**Written by:** mdpro-codex-audit. The hunch facts come from reading its source at `c220c73d`
(2026-09-27); the Jev facts from TypeSafe's docs and press coverage (§ 10).

## 0. Decisions for the user

S-U1 and S-U8 to S-U12 are answered (the user's words quoted in each row, relayed by
mdpro-delegator on 2026-10-16), and so is S0's Jev run. The rest are not decided. Where there is a recommendation, it is marked as a
proposal, with the reason. S-U2 to S-U4 now concern **only the on-device backup** (§ 5.0), and
stay gated on S0.

| # | Question | Options | Proposal |
|---|---|---|---|
| **S-U1** | **"Jev", and what to build** | A local substitute / B defer / C Jev in the cloud, opt-in, with the user's own key / D A by default plus C | **Answered: C, with a local backup.** The user's words are quoted in the header. Jev in the cloud is primary; a small on-device embedding model is the backup (§ 5.0); the key and the switch live in Settings → Integrations (§ 5.14). This sends document text off the machine, so it changes CLAUDE.md § Constraints, through S1's ADR only (§ 5.13). The options weighed are kept for that ADR |
| **S-U2** | **Where the backup's model files come from.** "Model files" means the whole package: weights, tokenizer, config, and for S-U4 A the ONNX Runtime WASM and the worker script (§ 5.6) | **A. Bundled** in the installer. The model files alone add 24–118 MB (§ 5.3); the installer growth is measured in S0. **B. Downloaded once**, on first use, from a pinned URL with a SHA-256 manifest, into `~/.mdpro/models/`. One-time network use, never at search time | Decide on S0's numbers. B keeps the installer small but adds a download path, a failure state and a "needs the network once" message. (A user-supplied model file was considered and dropped: a weights file alone can't say which tokenizer and pooling it needs; § 8) |
| **S-U3** | **Which backup model** | The candidates are in § 5.3: Chinese-first, multilingual, smallest, or a community "Jev-style" open model (§ 4.4) | Decide on S0's numbers, measured on the user's own kind of documents, Chinese and English separately |
| **S-U4** | **Where the backup's inference runs** | **A. In the webview:** ONNX Runtime Web (WASM) in a Web Worker, via `@huggingface/transformers` or `onnxruntime-web`. **B. In Rust:** the `ort` crate (ONNX Runtime; CoreML on macOS, DirectML or CPU on Windows) or `candle`, behind a Tauri command | Decide on S0, which must include the **minimum supported** macOS 13.1 WebKit (§ 3.4, § 9). A shares code across platforms, but stock ORT Web builds need WASM SIMD, which WebKit gained in Safari 16.4. B avoids that, at the cost of a native dependency in two release builds. **A cannot be chosen without minimum-OS evidence:** either S0 shows the pinned runtime working on macOS 13.1's WebKit, or the user explicitly accepts "semantic find unavailable below macOS X" together with a capability check and its message (the app's minimum stays 13.1) |
| **S-U5** | **The UI**, to be prototyped later (§ 5.9) | A separate key and bar (hunch's way), a mode switch inside v0.3.6's find popup, or semantic results under the literal ones; the highlight style; **which engine answered** and the **"text is leaving this Mac" indicator**; the **consent prompt**; and the **Settings → Integrations section** (§ 5.14) | **Not decided here.** Built with `/mattpocock-skills:prototype` (rule 70 § Questions) after v0.3.6's popup exists |
| **S-U6** | **The key** | Hunch uses ⌥F on macOS and Ctrl+Shift+F elsewhere, keeping ⌘F / Ctrl+F for normal find. On macOS ⌥F types a character (ƒ); Ctrl+Shift+F is unassigned in the menu plan's table | Decide with S-U5. The key goes through the menu plan's command table and collision rules (K1–K8) |
| **S-U7** | **The quality bar** (applied to each engine separately) | S0 proposes per-language numbers: recall@5 ≥ 0.80, first-hit accuracy ≥ 0.60, false "found" ≤ 10 % on absent topics, false "not found" ≤ 15 % on present ones (§ 6, S0). The user accepts or changes them **before** the final test partition is evaluated | Shown with S0's measured numbers, so the trade-off is concrete |
| **S-U8** | **Consent granularity** (§ 5.13) | A per document per session / B per document, remembered / C every search / D once globally | **Answered: A.** 「Per document per session (Recommended)」. The first cloud search in a document asks; the grant holds until the tab closes or the app quits; nothing about which files were sent is written to disk. "Just this search" stays available |
| **S-U9** | **Exactly what text is sent** (§ 5.13) | Always the query, the question template and each block's text; choices for front matter, code blocks and HTML comments | **Answered:** 「Blocks + code, no front matter (Recommended)」. Sent: the block text and code blocks. Not sent: YAML front matter. HTML comments: not sent either; the option the user picked said so in its description: 「Never YAML front matter or HTML comments (often metadata or private notes), and never the path, file name or title」. Never sent: the file path, file name, title, other documents, images, the key in any body |
| **S-U10** | **Which Jev version** | A pin an explicit version / B `jev-latest`, which TypeSafe moves (today → 1.13.0; `jev-preview` → 1.14.0) | **Answered: B.** 「jev-latest, 256k cap」. Requests send `jev-latest`. **Cost of this choice:** the 0.4 threshold and S0's quality numbers belong to the version S0 measured, and can drift without notice when TypeSafe moves the alias. **Guard** (cheap; it doesn't override the choice): every response's top-level `model` field (TypeSafe's API returns e.g. `"model": "jev-1.13.0"` for a `jev-latest` request) is logged on `search.semantic.jev.request`; if it is missing, the version is shown as "unknown", with no extra lookup (`GET /v1/models` stays a Settings-button call, § 5.6). Chunks of one search that report **different** versions mean the alias moved mid-search: the search is discarded and retried once, then falls back with "Jev version changing". The Integrations section shows "jev-latest → <version>" and the version S0 measured; when they differ, the section says so and `search.semantic.jev.version_changed` is logged once, as the trigger to re-run S0's held-out set (≈ $1 or less, with the user's key and word). The threshold is not changed automatically |
| **S-U11** | **Cloud size and cost cap** (§ 5.12) | A per-search input-token cap above which the backup answers | **Answered: 256 k input tokens per search** (same quote as S-U10), ≈ $0.011 per search at $0.042 / M tokens. Bigger searches go to the backup with "too large to send to Jev". Every query re-sends every block, so cost still scales with searches; S0's token counts show how often the cap bites |
| **S-U12** | **How the key is entered** (§ 5.14) | A a password field on the Integrations page / B a native prompt from Rust | **Answered: A.** 「Password field; S0 yes, $1 ceiling (Recommended)」. The key crosses the webview once, at entry, and is never sent back (§ 5.14). B stays possible later |
| **S0-Jev** | **May S0 run Jev with the user's key?** | yes with conditions / no | **Answered: yes** (same quote as S-U12). Conditions: synthetic fixtures only, never the user's documents; a key the user chooses, ideally separate and revocable, supplied by the user when S0 starts; a **$1 spend ceiling** for the run; the key never printed and never stored outside the keychain or that run's environment. S0 is a later implementation grant: mdpro-codex-audit asks the delegator before starting it |

## 1. Goal

Typing a phrase or a question into find highlights the **blocks** (paragraphs, list items,
headings, table rows) that are *about* it, even when they share no words with the query, ranked
by relevance. When nothing fits, mdpro says so ("not in this document") instead of showing zero
literal matches. This works in both editor modes, on one open document. **Jev**, TypeSafe's
hosted model, answers when the user has turned it on, entered a key and agreed for this
document; otherwise a small **on-device** model answers, with no network at search time. The
result always says which one answered.

It sits **beside** regular find, not instead of it. ⌘F / Ctrl+F stays the literal search that
v0.3.6 delivers.

## 2. Non-goals

- **Not a chat or a generator.** Nothing is written into the document. Hunch's own description
  of Jev applies to the substitute too: it scores, it does not generate text.
- **Not cross-document or folder search.** One open document at a time, as find works today.
- **No replace.** Semantic hits are blocks, not exact strings.
- **No cloud without opt-in.** The cloud switch is off by default; nothing is sent without a
  key, the switch on, and the document's consent (§ 5.13).
- **No mdpro-run account or proxy.** The user's own TypeSafe key calls TypeSafe directly; mdpro
  has no server.
- **No persisted index in v0.3.7.** Embeddings live in memory (§ 5.7); a disk cache is § 8's question.

## 3. Current state

### 3.1 Find in mdpro today

- **Source mode:** CodeMirror's `search({top:true})` and `searchKeymap`, mounted from
  `src/components/Editor/extensions/search.ts`. The keymap binds ⌘F (open the panel), ⌘G / ⇧⌘G,
  ⇧⌘L, ⌥⌘G and ⌘D (`@codemirror/search` `dist/index.js:1031-1037`). It does **not** bind ⌘H;
  replace is reached inside the panel. (The ledger row `docs/feature-ledger.md:233` claimed "⌘H 打开替换"
  until `12f51e7c` corrected it. In macOS, ⌘H hides the app today.)
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
  "no network" on the backup path, and "only api.typesafe.ai, only with consent" on the Jev path, need their own enforcement and tests (§ 5.6).
- `script-src 'self' 'unsafe-eval'` allows WASM compilation. **WASM SIMD arrived in WebKit with
  Safari 16.4**, so macOS 13.1's original WebKit may not have it, and ORT Web's multithreading
  needs cross-origin isolation, which mdpro does not set. Both are measured in S0 on the minimum
  OS, not only on a current Mac.
- The app has **no Web Worker** today; S-U4 A would add the first.
- **Rust already has an HTTP client:** `reqwest` 0.12 (`src-tauri/Cargo.toml:47`). The Jev call
  goes from Rust, so the webview's CSP doesn't change and the key never has to reach the page.
- **No keychain integration exists today**: no direct keychain dependency and no code using one
  (`security-framework` appears in `Cargo.lock` only as a transitive dependency). Storing the
  key there is a new dependency, so it goes in S1's ADR.
- **Settings → Integrations already exists**: `src/components/common/IntegrationsSettings.tsx`,
  on the rail between Image and Export, holding the MCP server switch and client list. The Jev
  settings are a new section on that page, not a new page (§ 5.14).
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

- TypeSafe's "flagship model and the first System One model". It evaluates typed questions
  (`choice`, `score`, `noul`) against a state and returns calibrated answers, not text.
- **Hosted only.** `POST https://api.typesafe.ai/v1/systemone` with `Authorization: Bearer <key>`;
  `GET /v1/models` lists models. TypeSafe documents no self-hosting, no on-prem and no open
  weights, and says the same weights serve every account (docs.typesafe.ai/models, 2026-10-16).
- **Versions:** `jev-1.13.0` (current) and `jev-1.14.0` (from 2026-10-14); `jev-latest` →
  1.13.0, `jev-preview` → 1.14.0. Hunch calls `jev-latest` through `@typesafe-ai/sdk`.
- **Limits:** 64 k tokens per request (state plus all questions), 32 k per question; a
  `TypeSafe-Danger-Zone-Long-Context: true` header raises both to 262 k, "slower and less
  accurate". Rate limits per organisation; over-limit is `429`.
- **Price:** $42 per billion input tokens ($0.042 per million); output tokens free.
- **Data:** "Jev is not trained on customer requests or responses." Zero data retention is
  described only for enterprise customers, by reference to the Legal page; retention for an
  ordinary key is **not stated** there (§ 9). The consent text must not claim more (§ 5.13).
- **Languages:** English is primary and most accurate; other languages, CJK included, are
  supported "but less accurate". S0 measures Chinese separately for that reason.

### 4.3 Side by side

| | Regular find (v0.3.6) | Hunch | This plan: Jev (primary) | This plan: backup |
|---|---|---|---|---|
| Matches | exact strings | blocks, by meaning | blocks, by meaning | blocks, by meaning |
| Model | — | Jev, in the cloud | Jev, in the cloud, the user's key | small on-device model (§ 5.3) |
| Network at search time | none | every search | every search, after consent | none |
| "Not in this document" | 0 matches | calibrated verdict | calibrated verdict, only when every chunk answered (§ 5.4) | only after the whole revision is indexed, threshold from S0; weaker |
| Modes | both (after v0.3.6) | web pages | both editor modes | both editor modes |

Whether Typora and VMark have semantic find was not re-checked (§ 9).

### 4.4 Is there an open-weight Jev? (researched 2026-10-16)

**No official one.** TypeSafe publishes no Jev weights. The Hugging Face org `typesafeAI`
(self-described "TypeSafe AI", unverified, links to typesafe.ai) has **no public models**, only
five `evalsafe-*` datasets. A Hugging Face search for "jev" returns about 50 models, all from
other authors. Of the cards read, DeBERTa's and AutoTrust's explicitly disclaim any TypeSafe
affiliation and JevEmbed's doesn't mention TypeSafe; the rest were not read. The relevant ones:

| Model | What it is | Licence | Size | Fit as the backup |
|---|---|---|---|---|
| `HIT-TMG/JevEmbed-Qwen3-Embedding-0.6B` | An **embedding** model fine-tuned (LoRA, merged) from `Qwen/Qwen3-Embedding-0.6B` to answer Jev-shaped `choice` / `score` / `noul` questions; card reports 94.4 % `noul` accuracy on its own test split. Doesn't mention TypeSafe | Apache-2.0 | 0.6 B, 1 024-d, F32 safetensors (≈ 2.4 GB); no ONNX published | **Candidate.** The closest open thing to Jev's question shape that is also an embedder; Qwen3 is multilingual, but the card states no languages. Needs an ONNX export and int8 quantisation, and is 10–25× bigger than § 5.3's models |
| `com-kotobalabs/open-jev-deberta-v3-large` | A cross-encoder "independent reproduction of the shape of" Jev: state + typed questions → calibrated probabilities (ECE 0.022 in-domain). "Not affiliated with TypeSafe, uses none of their data or code" | Apache-2.0 (base MIT) | ≈ 0.4 B, F32 (≈ 1.7 GB); 512-token context | **English only**, so not as the sole backup; possible as S0's reranker for English documents |
| `autotrust/JEV-9B` and family (27B, 35B) | Students **distilled from Jev 1.13's outputs** (via OpenRouter) on Qwen3.5-9B. "Not affiliated with, endorsed by, or a product of TypeSafe AI" | Apache-2.0 | 9 B, 18 GB; served on datacenter GPUs | **Excluded:** far too large for a desktop app, English-centric, and TypeSafe's customer agreement (§ 2.3(b)) restricts using the service or its output for distillation or imitation; whether that binds this third-party release is not established |
| `chaoliangUNSW/Jev-Style-0.8B-Decision-v3-GGUF` and similar | Small decoder "Jev-style" decision models in GGUF | various | 0.8–2 B | **Excluded for v0.3.7:** a llama.cpp runtime would be a third inference stack |

So S-U3's candidates are § 5.3's three plus `JevEmbed-Qwen3-Embedding-0.6B`, and S0 measures them
all the same way. A community model carries no promise of matching Jev's calibration, so the
backup keeps its own threshold (§ 5.4).

## 5. Proposed design

### 5.0 Two engines, and which one answers

**Jev** (cloud) and the **backup** (on-device) share extraction (§ 5.2), the literal tier and the
UI. They differ in scoring. One search is answered by **one** engine for the whole revision:
their scores are on different scales and are never mixed in one result list.

**Jev answers a search only when all of these hold.** Rust checks them (§ 5.12), not the page,
when the search starts and again before every chunk and retry:
1. the cloud switch (`semanticSearch.cloudEnabled`, read by Rust from preferences) is on;
2. a key is stored in the OS keychain and isn't marked rejected;
3. the calling window holds a consent grant for this document at the current `authEpoch`
   (§ 5.13);
4. the search fits the cap (S-U11);
5. Jev is not in a cool-down (rule 6);
6. the calling window's bar is not in "On this Mac only" mode (rule 9); Rust holds that flag
   per window too (`semantic_local_only_set`), so it's checked with 1–5.

**Otherwise, the backup answers.** When Jev was chosen but its outcome is anything other than
"every chunk answered and validated", the query is re-run on the backup, with the reason shown.
The outcome mapping is exhaustive; an outcome not listed here is a `Bug` and falls back too:

| Jev outcome (Rust error enum) | What happens | The verdict line says |
|---|---|---|
| every chunk answered, every response validated (§ 5.12) | Jev's results shown | "Jev (cloud) · N related blocks" |
| `401` / `403` → `KeyRejected` | no retry; key marked rejected until it is replaced or removed | "On this Mac · Jev key rejected — check Settings → Integrations" |
| `429` → `RateLimited` | retries per § 5.12; then backup | "On this Mac · Jev busy (rate limit)" |
| network error, timeout, `5xx` → `Unreachable` / `Timeout` | retries per § 5.12; then backup | "On this Mac · Jev unreachable" |
| `400` context-length → split the chunk once; still failing → `TooLarge`. `413` → `TooLarge`. Estimate over the cap → `TooLarge` (no request) | backup | "On this Mac · too large to send to Jev" |
| other `400`, `415`, `422` → `BadRequest`; unknown model or version → `ModelUnavailable` | backup; logged as a bug, not retried | "On this Mac · Jev request failed" / "Jev version unavailable" |
| `2xx` with missing, duplicate or unknown block ids, wrong question type, or a probability that isn't finite in [0, 1] → `InvalidResponse` | backup; never treated as "nothing found" | "On this Mac · Jev answered incorrectly" |
| some chunks fine, one fails terminally → `Partial` | siblings cancelled; Jev's answers discarded; backup | "On this Mac · Jev answered only part of the document" |
| cancelled (new input, edit, close, revoke, switch off, key change) → `Cancelled` | nothing shown from it; no fallback for a superseded query | — |

6. **Cool-down.** Counted per **search**, by its terminal outcome: `Unreachable`, `Timeout` and
   `RateLimited` count, and so does a `Partial` whose cause (kept in the enum, `Partial { cause }`)
   is one of them; any successful Jev search resets the count to 0. With chunks in parallel, the
   **first** terminal failure recorded under `JevState`'s lock decides the search's outcome; the
   siblings it cancels don't count. After 3 in a row, Jev
   is skipped app-wide for 60 s (the key is app-wide, so the breaker is too). `KeyRejected` is
   not a cool-down; it lasts until the key changes. Searches skipped by the cool-down don't count.
7. **The backup itself unavailable** (switched off, not installed, failed): if Jev can't answer
   either, the verdict says "Semantic search unavailable: <reason>". Literal results stay.
8. **One engine per result, no flicker.** Jev's chunk answers are **buffered** until the search
   completes: while it runs, the bar shows "Asking Jev… k of n" and no Jev hits. So a shown
   result never changes engine; a fallback starts from an empty semantic list. (The backup still
   shows hits as its index grows, which is the same engine.)
9. **"On this Mac only"** is a mode of the open bar: it lasts until the bar closes (the next open
   is back to normal), survives query edits, and switching it on mid-search cancels the Jev
   request and re-runs on the backup. It doesn't touch the document's consent; revoking is a
   separate action (§ 5.13).
10. **Coverage is said, not implied.** Jev's coverage is the blocks it was sent: S-U9's
    exclusions are never searched by Jev, and the backup's coverage is § 5.7's. The literal tier
    always covers the whole document, excluded blocks included. A "nothing" verdict names a
    restricted coverage ("Nothing among the 412 blocks searched; front matter not searched"), and
    a fallback never claims more coverage than the backup has.

The attribution and the "text is leaving this Mac" indicator are prototype items (S-U5, § 5.9).

### 5.1 Pipeline

```
open semantic find
  → literal = v0.3.6's matcher over the whole document (5.4; no model, no limits)
  → occurrences = extract(markdown)      in a worker, sliced, cancellable (5.2)
  → backup: index(revision)              embed unique block texts, progressive (5.5, 5.7),
                                         only if the backup may answer this document (5.0)
query (min length per 5.2, debounce, new input cancels)
  → choose engine (5.0)
      Jev:    consent (5.13) → Rust jev client: chunk, send, collect p per block (5.12)
              → on failure: re-run on the backup (5.0 table)
      backup: q = embed(query) → cosine per block
  → rank: literal tier first, then semantic (5.4)
  → highlight occurrences, step, verdict + engine + indicator (5.9)
every async result → accepted only if its tags still match (5.5)
```

### 5.2 Blocks: one parser, both modes

- **Extraction parses the document's Markdown text once, with the same remark transforms Milkdown
  runs, in the same order.** `mdproCommonmark` is a `MilkdownPlugin[]`
  (`src/plugins/milkdown/commonmarkPreset.ts:39`), not a remark processor a worker can import, and
  the editor also applies `tableParityPlugins` after GFM (`MilkdownEditor.tsx:157`). So S2 first
  extracts a **worker-safe remark composition**, `src/plugins/milkdown/remarkComposition.ts`: an
  ordered list of plain remark plugins (remark-parse → the commonmark preset's remark plugins
  with mdproCommonmark's swaps: link definitions kept, blank-line gaps → remark-gfm → the
  remark side of `tableParityPlugins` → `remarkHighlightTransformer` from `highlightMarkPlugin`
  (`==text==` → a highlight node; `MilkdownEditor.tsx:166`, `highlightMarkPlugin.ts:61`)). A test
  enumerates every remark plugin the mounted editor registers and fails if one is missing from
  `remarkComposition.ts` or out of order, so a plugin added later can't silently diverge. Milkdown's wiring is rebuilt from that list, so there is
  one source of truth, and the worker runs the same list. Parity fixtures, both sides: ragged
  tables, link reference definitions, footnote definitions, blank-line gaps, empty paragraphs and
  `==highlight==` (with an `=` inside).
  It is independent of either editor's parser.
- **Where it runs:** in a dedicated **extraction worker** (separate from the backup's, so
  terminating one doesn't take the other down). The Markdown text is posted once.
  - **Admission first:** before posting, the controller reserves the extraction's estimated peak
    (proposal: 20 × the text's UTF-8 bytes, replaced by S0's measured factor) with `SemMemory`
    (§ 5.7); a refusal means "Too large for semantic search", and literal find still works.
  - **Cancellation by termination:** remark's parse is one synchronous call inside the worker, so
    it can't be interrupted from inside. A cancel (new revision, close, disable) terminates the
    worker (`worker.terminate()`) and the next extraction starts a fresh one.
  - **The controller settles a cancelled run itself**; nothing waits for the killed worker, which
    sends no final message. Each run has an `extractionGeneration`, and its `SemMemory`
    reservation is keyed by `(documentId, extractionGeneration)`. On cancel the controller, in
    one step: terminates the worker, resolves the run's promise as `Cancelled`, releases that
    reservation (`semantic_mem_release` is idempotent by key, so it happens exactly once and an
    old generation's release can't free a newer run's), and drops its references. A late message
    from a terminated worker can't arrive; one from a superseded live worker is dropped by
    generation. Normalising and
    hashing then run in slices of top-level blocks with a cancellation check between slices. The main thread only reads the
  editor's block sequence for mapping (below), in budgeted slices of ≤ 8 ms; above the WYSIWYG size threshold
  the existing scroll code already uses (`src/utils/scrollAnchor/source.ts:11`), mapping is done
  lazily, for hits only. S0 measures the semantic-open latency, the longest main-thread task and
  peak extraction memory (§ 5.8). Each **occurrence** is
  `{ occurrenceId, blockKey, text, kind, sourceRange }`, where kind is a paragraph, a heading, a
  list item (its own paragraph, without nested lists), a table row (cells joined with ` | `), a
  blockquote paragraph, or a code block.
- **Mapping to the editors:** in Source, `sourceRange` *is* the CodeMirror range. In WYSIWYG, the
  occurrence has to be mapped to a ProseMirror position, and **no such mapper exists today**.
  The TOC's `src/utils/tocElementResolution.ts` maps heading keys to DOM elements by sequence
  and text, which is the nearest precedent and not a source ↔ PM mapper. S2 builds one, and it
  **fails closed**:
  - both sides become sequences of `(kind, normalised text)`, with one normalisation applied to
    both (mdast `toString` vs PM `textContent`; whitespace collapsed; NFC);
  - the sequences are aligned as a whole, not by a greedy forward search, so one missing or
    transformed block doesn't shift every later match. The algorithm is bounded: a **patience
    diff** first anchors on keys that are unique on both sides (O(n log n)); only the gaps between
    anchors get a Myers diff, each capped at 2 000 edit steps, and a gap over the cap is left
    unmapped;
  - **alignment runs in the extraction worker, not on the main thread**, so its cost and its
    cancellation are the worker's (terminate, below). The main thread's only share is copying
    the PM side out, **raw**: normalisation happens in the worker. The copy does **not** use
    `doc.nodesBetween` or `doc.textBetween`: both rescan earlier siblings from index 0 on every
    call and can't be stopped part way (prosemirror-model 1.25.4 `fragment.ts`). It walks the
    tree with its own **persistent cursor**: a stack of ancestor frames `(node, childIndex,
    pos)` plus an offset inside the current text node, so a slice resumes where the last one
    stopped without rescanning. Inside a slice, the deadline (≤ 8 ms) and the cancellation flag
    are checked **during the walk**, after every 256 visited nodes and after every text piece;
    a text node is copied in pieces of at most 16 KiB (`text.slice(offset, offset + 16384)`). So
    one huge paragraph, code block, nested list or a paragraph of thousands of differently
    marked inline nodes is read across many slices. The cursor is valid only for the document
    it was taken from: any transaction that changes the document discards it and restarts the
    copy (the extraction generation moves on). Each textblock is sent
    as `(kind, startPos, raw text pieces)`; the worker joins, normalises and aligns them and
    returns `occurrenceId → PM position` pairs;
  - a pair is accepted only if it is unique within its aligned stretch; an ambiguous one (two
    equal candidates, e.g. a repeated paragraph next to a changed block) stays **unmapped**.
  **Unmappable policy:** an occurrence that doesn't align is logged (count only) and kept in the
  index; in WYSIWYG it isn't highlighted or stepped to, and the verdict says so ("N related
  blocks · k shown in Source only"). It never makes the verdict "nothing".
- **Duplicates:** identical texts are embedded **once** (by `blockKey`, a hash of the normalised
  text), and every occurrence keeps its own range, so a repeated paragraph highlights everywhere.
- **Minimum lengths are proposals, measured in S0:** hunch's 12-character block minimum and
  3-character query minimum would drop short Chinese headings and a two-character query such as
  「收入」. The proposal: headings are always kept whatever their length; other blocks count CJK
  characters as 2 toward a minimum of 12; the query minimum is 2 for CJK and 3 otherwise.
- **Occurrences don't depend on either engine.** Splitting long blocks is per engine, into
  **windows** with ids `Bnnn.w`:
  - **Jev windows** by UTF-8 bytes: ≤ 24 000 bytes (§ 5.12), cut at a sentence or whitespace
    boundary, 10 % overlap; no tokenizer needed, so Jev works with the backup missing;
  - **backup windows** by the backup's tokenizer: its limit minus prefix and special tokens, with
    overlap (§ 5.3).
  A block's score for an engine is the best of its windows' scores.
- **S-U9's exclusions survive WYSIWYG.** Milkdown has no front-matter plugin: the YAML block
  becomes a thematic break plus a setext heading (`src/utils/scrollAnchor/anchor.ts:26`), so
  extracting from the editor's serialised Markdown would send it as ordinary heading text. So:
  - the front-matter range is computed from the **source text before Milkdown parses it** (on
    open, reload, and every switch into WYSIWYG);
  - in WYSIWYG, the PM nodes that range produced are recorded in a ProseMirror plugin state as
    *excluded*, and the set is mapped through every transaction (`tr.mapping`), so they stay
    excluded after edits;
  - **fail closed:** a document is marked `hadFrontMatter` for the session as soon as any of its
    texts (opened, reloaded, or the current Source text) starts with a front-matter block.
    Provenance counts as **certain** only in two states: the current Markdown starts with a
    front-matter block (then that block is excluded by position), or the current WYSIWYG editor
    generation was seeded from pre-parse source and its plugin state is intact. In any other
    state for a `hadFrontMatter` document (after a WYSIWYG serialisation turned it into a heading,
    an editor rebuild, a reload of already-transformed text, or edited values), **Jev is not used
    for that document**: the backup answers with "On this Mac · front matter can't be separated
    safely". The document's front matter is never guessed at;
  - **across saves and restarts:** session state can't help once the transformed text is saved
    and the app restarts, because the file then has no front matter to detect. Whether a WYSIWYG
    **edit + save** actually writes front matter back as an ordinary rule and heading is **not
    verified** (an unedited open is byte-identical,
    `tests/wysiwyg-edit-persistence.test.tsx:248` "P-clean-open"). **S-FM** (§ 6) checks it first.
    If it does, that is a data-integrity defect of its own, reported to the delegator for a D
    number, and its fix (front matter kept as a front-matter node through WYSIWYG, round-tripping
    byte-exactly) is a **hard prerequisite**: S-C3 doesn't enable Jev until S-FM passes;
  - HTML comments: comment blocks are never occurrences, and inline comments are stripped from a
    block's text; comment-like text inside a code block is code, and is sent (S-U9 sends code).
  S2 tests the **outgoing request body**, not just the occurrence list, after WYSIWYG edits, a
  mode switch each way, and a reload.

### 5.3 Model candidates (S-U3, measured in S0)

Sentence-embedding models in ONNX form. Sizes are from their Hugging Face file listings
(2026-10-16), and the licences are from the upstream model cards (both MIT, confirmed in review):

| Model | Languages | Output | Pooling | Input limit | int8 ONNX | fp32 ONNX |
|---|---|---|---|---|---|---|
| `BAAI/bge-small-zh-v1.5` (`Xenova/` export) | Chinese-first | 512-d | CLS, normalised | 512 tokens | 23.9 MB | 94.9 MB |
| `intfloat/multilingual-e5-small` (`Xenova/` export) | ~100 languages | 384-d | masked mean, normalised; `query:` / `passage:` prefixes | 512 tokens | 118 MB | 470 MB |
| `paraphrase-multilingual-MiniLM-L12-v2` (`Xenova/` export) | 50+ languages | 384-d | mean | 128 tokens (model default) | 118 MB | 470 MB |
| `HIT-TMG/JevEmbed-Qwen3-Embedding-0.6B` (§ 4.4; Apache-2.0) | not stated (Qwen3 base is multilingual) | 1 024-d | per its JevEmbed config | trained at 1 024 tokens | no ONNX published; S0 exports and quantises (≈ 0.6 GB expected at int8) | ≈ 2.4 GB (safetensors) |

These are model-file sizes. Installer growth also includes the tokenizer and, for S-U4 A, the ORT
WASM build, and is measured in S0.

The **inference contract** is per model, not just `embed(texts[])`: tokenizer, prefixes, pooling,
normalisation and window size are part of the model's manifest (§ 5.6). Two runtimes for the same
model must produce the same vectors within a tolerance on a fixed fixture (an S3 test).

A **cross-encoder** (reranker) is closer to Jev's per-block question. S0 measures one as a second
stage over the embedding top-k (for example 50). It is adopted only if it fits § 5.8's budget.

### 5.4 Ranking and the "not in this document" verdict

- **Literal results have their own path.** v0.3.6's literal matcher (case-insensitive) runs over
  the **whole document text**, independent of occurrences: no minimum length, no S-U9 exclusion,
  no § 5.7 limit, and no model, so literal results exist even when both engines are unavailable.
  Each literal match is a range; it is attached to the occurrence that contains it if there is
  one, and otherwise listed on its own (front matter, a comment, a short line).
- **Two tiers, not a bonus:** literal entries are always ranked above semantic-only blocks,
  whatever their similarity. A block with both a literal match and a semantic score appears
  **once**, in the literal tier. Semantic thresholds and limits never remove a literal entry.
  Within each tier, entries are ordered by similarity (literal-only entries last, in document
  order). This is what "augmented" means: everything literal find would show, plus the related
  blocks.
- **Jev's threshold:** p ≥ 0.4 on the `noul` answer, as in hunch, re-checked in S0 on the version
  `jev-latest` resolved to at the time, and re-checked when it moves (S-U10's guard).
- **The backup's threshold:** cosine similarity is not a calibrated probability, the way Jev's `noul`
  is. S0 compares a fixed per-model threshold with a relative rule (the top score must clear the
  document's median by a margin) on S0's **validation** partition, and S1 records the winner.
  The final test partition is not used for this choice (§ 6, S0).
- **The verdict depends on coverage:**

  | Index state | Verdict shown |
  |---|---|
  | loading / partial (backup) | "Searching… N% indexed", plus the backup's hits so far. Never "not in this document" |
  | chunks outstanding (Jev) | "Asking Jev… k of n", **no hits yet** (§ 5.0 rule 8). Never "not in this document" |
  | complete, hits | "N related blocks" |
  | complete, none above the threshold | "Nothing in this document looks like that" |
  | cancelled / failed | "Semantic search stopped: <reason>". Literal results stay |

- Percentages like hunch's are not shown unless S0 calibrates the score (S-U5, § 8).

### 5.5 Async results: the acceptance contract

Every index or query result carries tags: `documentId`, `editorGeneration`, `editRevision`,
`queryGeneration`, `engine` (`jev` / `backup`), `modelId` (the Jev version or the backup model),
for the backup its `runtimeGeneration`, and for Jev the epoch pair `(appEpoch, grantEpoch)`
(§ 5.12). The backup's `runtimeGeneration` only increases: it is bumped on disable, model removal,
model reload and worker replacement, so a completion from before a disable can't match after a
re-enable of the same model. Rust bumps `appEpoch` on key set,
key removal and the cloud switch going off, and `grantEpoch` on revoke and tab close, so a
completion from before any of those can't be accepted after a re-enable. The controller accepts a result only if every tag still matches
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

### 5.6 The backup's offline packaging, and egress enforcement for both engines

- **A pinned model package:** the weights, `tokenizer.json`, config, the pooling and prefix
  manifest, and for S-U4 A the exact ORT WASM files and the worker script. Every file is listed
  with its SHA-256 in a manifest checked at load time.
- **No remote fallback:** for transformers.js, `env.allowRemoteModels = false` and local paths
  only. The files load through Tauri's `asset:` protocol or IPC; that route is defined in S3,
  and the CSP is updated in the same commit if it needs to be.
- **Egress, three separate permissions**, each with its own allowlist and tests, all from Rust:
  1. **Search:** `POST https://api.typesafe.ai/v1/systemone`, only for a search that passed
     § 5.0's conditions.
  2. **Key test:** `GET https://api.typesafe.ai/v1/models`, only from the Settings button; it
     carries the key and nothing from any document.
  3. **Backup download** (S-U2 B only): `GET` from the pinned package origin, only from the
     Settings button or the first-use prompt; it carries nothing.
  The backup's search path reaches nothing.
- **Transport policy:** the origin and paths are compile-time constants; `reqwest` is built with
  `redirect::Policy::none()` and `https_only(true)`. A test-only base URL (behind `#[cfg(test)]`)
  points at a local mock; release builds can't change it. Tests: a `3xx` to another host or to
  `http:` is refused, and nothing (body or key) is sent onward.
- **Enforced and tested across boundaries:** a test fails if the backup path (main thread,
  worker or Rust command) opens a connection to any non-local origin, or if the Jev client is
  called without consent, with the switch off, or to any other host. That is done with a mocked
  transport at each boundary, not just a main-thread `fetch` spy. The release check proves a cold
  start offline: the network is off, the model loads, and the search works.

### 5.7 Memory and limits

- **Per document:** at most `MAX_SEM_BLOCKS` unique block texts (proposal: 50 000) and
  `MAX_SEM_VECTOR_MB` of vectors (proposal: 128 MB). Past either limit, semantic find indexes the
  first N blocks and says "Too large for semantic search: searched the first N blocks". Literal
  find is unaffected.
- **Across the app:** at most `MAX_SEM_TOTAL_MB` (proposal: 256 MB) of indexes, with
  least-recently-used tabs evicted first. Windows don't share memory, so the owner is **Rust**,
  the one process-wide party: a `SemMemory` coordinator in managed state. A window reserves before
  it builds an index (`semantic_mem_reserve(documentId, bytes)` → granted, or granted after
  evicting listed indexes, or refused); a window asked to evict frees the index and acknowledges
  (`semantic_mem_release`); a window's reservations are released when it is destroyed. The
  reservation counts vectors, occurrence metadata and a transient-copy allowance (2× vectors
  while results cross the worker or IPC boundary). Under S-U4 B the indexes live in Rust and the
  coordinator is in-process. An evicted tab re-indexes when it is searched again. S-C3 tests two
  windows reserving at once at the limit.
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
| Semantic open | the key → bar ready to type | ≤ 100 ms, whatever the document size (extraction continues in the worker) |
| Longest main-thread task during extraction and mapping | — | ≤ 50 ms on the 10 MiB short-line fixture |
| Peak extraction memory | worker heap during extraction | measured in S0; feeds § 5.7's reservation |

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
7. **Settings → Integrations, "Semantic search" section** (§ 5.14): its layout, in D260's rail
   style.
8. **Which engine answered:** a badge or wording in the verdict ("Jev (cloud)" / "On this Mac"),
   and the fallback reasons from § 5.0's table.
9. **"Text is leaving this Mac"**: an indicator visible for as long as a Jev request is in
   flight, distinct from the progress text.
10. **The consent prompt** (S-U8), and the bar's "On this Mac only" choice (§ 5.0 rule 9).
11. **Who owns the find keys while semantic results show.** A proposal, for the prototype to
    settle, then tested through the composed keymaps and the menu dispatch in both modes:

    | Input | With the semantic bar open |
    |---|---|
    | Enter / Shift+Enter (focus in the bar) | next / previous semantic result |
    | ⌘G / ⇧⌘G, F3, menu Find Next / Previous | next / previous semantic result while the bar is open; literal find's otherwise |
    | ⌘F / Ctrl+F, menu Find | closes the semantic bar and opens literal find with the same query |
    | ⌘H / Ctrl+H, menu Replace | closes the semantic bar and opens replace (semantic find has none) |
    | Esc | closes the bar and clears its highlights |

    In Source, CodeMirror's own search state (query, panel, selection of matches) is never
    changed by semantic results: they are separate decorations, and closing the bar leaves
    CodeMirror's search as it was.

### 5.10 Failure and recovery

Everything in this section is about the **backup**; Jev's failures are § 5.0's table. A backup
failure never disables Jev, and Jev keeps working with the backup off or missing (S-C3 tests it).

- **Backup switch** (Settings → Integrations, § 5.14): off unloads the backup model and frees every
  index; Jev and regular find are untouched. There is no third, global switch: both switches off
  means semantic find says "turned off in Settings".
- **Missing or corrupt model package, or a hash mismatch:** the backup stays off for the session
  with a message; Jev and regular find work.
- **A worker crash, or an out-of-memory error inside the worker:** the worker is restarted
  once. If it fails again, the backup is off for the session with a message. A Rust task
  error surfaces as the command's `Err`.
- **What is guaranteed, and what isn't:** for the recoverable failures above, the editor and
  the document are unaffected. A **native** failure is not covered: an ONNX Runtime abort or a
  process-level out-of-memory inside mdpro's own process (S-U4 B, or the webview process under
  A) can take mdpro down. The only defences are § 5.7's limits and S0's worst-case memory
  measurement, and S-U4's choice weighs that risk.
- **Removing the model:** cancels in-flight backup work, unloads the model, then deletes the
  files. A Jev search in flight continues; a search that would fall back during removal gets
  "Semantic search unavailable: backup being removed".
- **Late completions after disable or removal** are dropped by § 5.5's `runtimeGeneration`, so
  they can't reload the model or recreate an index, including after a quick disable → re-enable
  of the same model. S5 and S8 test both.

### 5.11 Logging (rule 20)

Events: `search.semantic.model.load`, `.model.remove`, `.index`, `.query`, `.cancel`, `.stale`
and `.error`. They follow rule 20's start and outcome pairing, with one `actionId` per operation.
A cancellation ends the original operation with status **`cancel`** (`LogStatus` in
`src/types/logging.ts:3`) on the same `actionId` as its `start`, not as a `fail`.

What they carry: counts, milliseconds, the model id, the engine, the index state, the query's
**length**, and for Jev the HTTP status class, the number of chunks and the input token count.
Never document text, the query, the API key, any part of the key, or the `Authorization` header.
Cloud events: `search.semantic.jev.request`, `.jev.fallback` (with the § 5.0 reason as an
enum), `.consent` (granted / denied / revoked, never the path), `.key.set` / `.key.remove` /
`.key.test` (outcome only). Each WI that adds a path (S3 load and inference, S5 index and
stale, S-C1 key, S-C2 requests, S-C3 consent and fallback, S-C4 and S-C5 settings, S8 download and removal) adds its events and two tests: every `start`
ends in exactly one `success`, `fail` or `cancel` with the same `actionId`, and no event carries
document or query text.

### 5.12 The Jev client (Rust)

- **Where:** `src-tauri/src/services/jev/` with `reqwest` (already a dependency). The key is read
  from the keychain inside Rust and never returned to the page.
- **Rust is the authority** (rule 60 § IPC trust boundaries). A `JevState` in Tauri managed
  state, behind a `Mutex`, holds: the consent grants, keyed by `(windowLabel, documentId)`, each
  with its `authEpoch`; the rejected-key flag; the cool-down counter and expiry; and the request
  registry. `semantic_jev_search` takes the window from Tauri's `WebviewWindow` argument, not
  from the payload, and checks § 5.0's conditions 1–5 there; the grant must belong to that
  window. A webview calling the command directly without a grant gets `NotAuthorised` and
  nothing is sent.
- **Two kinds of grant.** "Allow for this document" is a document grant for
  `(windowLabel, documentId)` that lasts per S-U8. "Just this search" is a **one-shot** grant
  bound to `(windowLabel, documentId, requestId)`: consumed by the first `semantic_jev_search`
  with that request id, and expired after 30 s or when that window's query generation moves on.
  A second search with the same request id gets `NotAuthorised`.
- **Epochs and ordering.** Two counters, both in `JevState`:
  - the **app epoch**, bumped by key set, key removal and the cloud switch going off;
  - a **grant epoch** per `(windowLabel, documentId)`, bumped by revoke and by tab close.
  A search records both at its start; Rust compares both before each chunk, before each retry
  and before returning, and a mismatch ends it `Cancelled`. Every grant, revoke, key and switch
  operation takes the same lock, so they are totally ordered. A grant request carries **both**
  epochs under which the consent prompt was shown, `(appEpoch, grantEpoch)`; Rust compares both
  under the lock, and one that arrives after a key change, a switch-off, a revoke or a tab close
  is refused as `StaleGrant`, so a prompt answered late can't re-authorise anything.
- **Where the controller gets the epochs:** `semantic_auth_state(documentId)` returns
  `{ appEpoch, grantEpoch, granted, keyStatus }` for the calling window; the controller calls it
  when the bar opens and before showing a consent prompt. Epochs only increase.
- **Tab close and window destruction reach Rust.** A tab close is revoked **inside the backend
  close itself**: `close_document` (`src-tauri/src/commands/file.rs:1580`, which already removes
  the document from the shadow store once the close is committed) also calls
  `JevState::close_document(windowLabel, documentId)`, which removes the grants, bumps the grant
  epoch and cancels the requests in the same call. No separate revoke after the close, so no
  open-tab check can refuse it; a close that the unsaved-changes prompt cancels never reaches
  `close_document`, so its grant stays. A
  window's destruction is handled in Rust, in the existing `on_window_event` hook on `Destroyed`
  (`src-tauri/src/main.rs:299`, the same event the quit guard uses): every grant of that window
  is removed, its grant epochs bumped, its requests cancelled and its memory reservations
  released, so cleanup doesn't depend on a webview that no longer exists. Tests: a committed
  close; a cancelled close (the grant stays); a close with a consent prompt pending; queued
  chunks; an IPC call arriving from a destroyed window's label.
- **Across windows:** after any epoch bump Rust emits `semantic:auth-changed` with
  `{ scope: "app" | "document", windowLabel?, documentId?, appEpoch, grantEpoch? }` to every
  window, carrying the **new** values. Each controller keeps the highest epochs it has seen and
  ignores any event, command reply or completion carrying lower ones (events and replies can
  arrive in either order); on a higher value it cancels its affected searches and closes any
  open consent prompt. This is a new Rust → frontend
  event, so it gets a row in CLAUDE.md's events table in S-C3's commit.
- **What Rust does not verify:** that the block text really came from the granted document. It
  can't, cheaply: the MCP shadow store lags edits by up to 300 ms (rule 50 § 4). So the webview
  is trusted for **what** the text is; Rust enforces **where** it goes (one fixed origin), **whether**
  it may go (switch, key, grant, epochs, local-only), **how much** (the cap) and **from which
  window**. A compromised webview could send other text from the same window to TypeSafe under
  the user's own key; S1's ADR records that residual risk.
- **Payload bounds:** at most `MAX_SEM_BLOCKS` blocks and S-U11's cap in estimated tokens; ids
  validated; the query ≤ 200 characters; anything else is `BadRequest` before any network use.
- **Request shape** follows hunch (§ 4.1): the state is the `Bnnn| text` block list (no URL, no
  title, unlike hunch); one `noul` question per block with hunch's wording translated to
  "this document"; ≤ 200 blocks per chunk.
- **Both context limits.** Jev's tokenizer isn't published. The plan **assumes** it produces no
  more tokens than UTF-8 bytes (true of byte-level BPE, the common case), so it sizes by bytes;
  S0 checks the assumption against the token counts Jev reports or bills, and the overflow
  fallback below holds either way. Chunks are packed against **actual encoded sizes**:
  - the query is ≤ 200 Unicode scalar values (so ≤ 800 UTF-8 bytes);
  - each block's question size `qᵢ` = the UTF-8 bytes of the template, its id and the query;
  - blocks are added in order while: block count ≤ 200, state bytes ≤ 24 000,
    state bytes + Σ `qᵢ` ≤ 60 000 (64 k with a 4 k margin), and state bytes + max `qᵢ` ≤ 30 000
    (32 k per question with margin);
  - a block whose own text exceeds 24 000 bytes is split into Jev windows first (§ 5.2), by bytes,
    so the backup's tokenizer is never needed.
  With a 200-character CJK query (`qᵢ` ≈ 1 400 bytes) and a full 24 000-byte state that is 25
  blocks per chunk; with short blocks and a short English query, up to 200.
  **Overflow fallback:** a `400` context-length error splits the chunk in half once; a second
  one ends the search `TooLarge`. Tests at every bound, with CJK text (3 bytes per character).
- **Retries and deadlines:** 15 s per request; retries on `429` / `5xx` / network errors with
  exponential backoff, honouring `Retry-After`, ≤ 5 per chunk; and a **total search deadline**
  of 20 s, after which remaining work is cancelled and the outcome is `Timeout`. Rust re-checks
  the authorisation (conditions 1–5 and the epoch) before each chunk and each retry.
- **Concurrency:** at most 4 requests in flight **app-wide**, across windows. A terminal failure
  of one chunk cancels its siblings.
- **The cap counts every attempt:** retried bytes count against S-U11's cap; a retry that would
  exceed it isn't sent and the search ends `TooLarge`.
- **Response validation:** every chunk's answer must name exactly the block ids it was sent, with
  the `noul` type and a finite probability in [0, 1], from a model (`jev-latest` resolves to whatever TypeSafe points it at; the reported version is recorded, S-U10). Anything
  else is `InvalidResponse` (§ 5.0 table); a chunk is never counted as "answered: nothing".
- **Model:** `jev-latest` (S-U10). Each response's `model` field is logged and kept for the Integrations section's drift notice; all chunks of one search must report the same version (S-U10's row).
- **Progress is a channel.** `semantic_jev_search` takes a Tauri 2 IPC `Channel`; Rust sends
  `{ requestId, appEpoch, grantEpoch, done, total }` after each chunk, and the controller applies a
  message only if its request and epochs are current. "Asking Jev… k of n" comes from it. S-C3
  tests stale and cancelled progress.
- **Cancellation is a command, not a dropped promise.** Each search registers its `requestId` in
  the registry with a cancellation token; `semantic_jev_cancel(requestId)` cancels its queued
  chunks, retries and active requests. A revoke, switch off, key change or tab close bumps
  `authEpoch` and cancels every request in that scope. Late responses are dropped by § 5.5's tags.
- **Commands** (all return `Result`, are registered in `commands/mod.rs`, with wrappers in
  `src/services/semanticFindService.ts`): `semantic_jev_search` → per-block p, or the error enum
  `NotAuthorised | StaleGrant | NoKey | KeyRejected | RateLimited | Unreachable | Timeout |
  TooLarge | BadRequest | ModelUnavailable | InvalidResponse | Partial { cause } | Cancelled`;
  `semantic_jev_cancel`; `semantic_consent_grant` (document or one-shot, carrying the prompt's epochs; window from Tauri,
  document id validated against that window's open tabs) / `_revoke` (the user's "Stop sending";
  idempotent: revoking a grant that no longer exists is a no-op success);
  `semantic_local_only_set`; `semantic_auth_state`; `semantic_key_set`, `semantic_key_remove`, `semantic_key_status` (returns
  `set` / `not set` / `rejected` only), `semantic_key_test`. Error values never contain the key,
  document text or the query.

### 5.13 Consent, privacy and the constraint change

- **What is sent, exactly:** the query; the question template; and the text of each block of the
  current revision of **this** document, after S-U9's exclusions, deduplicated. Not sent: the
  file path or name, the window or tab title, other documents, images, drafts, preferences, or
  anything when the search runs on the backup. The key travels only in the `Authorization`
  header.
- **Who receives it:** TypeSafe AI, at `api.typesafe.ai`, under the user's own account. What
  TypeSafe states (§ 4.2): not used for training; retention for ordinary keys not stated. The
  consent text says exactly that, and links to TypeSafe's privacy page.
- **Consent:** per S-U8. The prompt names the document, says what is sent and to whom, and offers
  "Allow for this document", "Just this search" and "Search on this Mac instead". Default
  focus is on the on-device choice. The grant is held in Rust (§ 5.12). **Revoking** is a
  separate action: "Stop sending this document to Jev" in the bar, the cloud switch off, removing
  the key, or closing the tab (S-U8 is A). Each bumps `authEpoch` and cancels in-flight requests.
  "On this Mac only" is not a revoke (§ 5.0 rule 9).
- **Indicator:** while a Jev request is in flight, a visible "Sending to Jev" mark (S-U5 item 9);
  the verdict then says "Jev (cloud)".
- **The constraint change.** S1's ADR records the user's decision (quoted in this plan's header),
  the options weighed (S-U1 A, B, C, D, each with why it lost or won), the privacy cost, and the
  new wording of CLAUDE.md § Constraints. Proposed wording:
  > Local files only (no cloud sync). One exception, opt-in (ADR-NNNN): semantic find may send
  > the open document's block text and the query to TypeSafe's Jev API, with the user's own API
  > key, only after the user turns it on in Settings → Integrations and agrees for that document.
  > Nothing else leaves the machine, and every feature works without it.

  CLAUDE.md is edited only when that ADR is **Accepted**, in the same commit. The ADR number is
  requested from the delegator when S1 starts.

### 5.14 Settings → Integrations: the "Semantic search" section

A new section on the existing Integrations page (§ 3.4), below the MCP section, in D260's rail
and page style (DESIGN.md). Its layout is a prototype item (S-U5); its contents are:

| Control | Behaviour |
|---|---|
| **Use Jev (cloud)** switch | off by default; on needs a stored key (otherwise disabled, with the reason inline, rule 30.4) |
| **API key** | entered per S-U12 (below). **Save** stores it in the OS keychain (macOS Keychain, Windows Credential Manager); **Remove** deletes it; status reads "Key stored" / "No key" / "Key rejected", never any part of the key |
| **Test key** | `GET /v1/models`; shows OK / rejected / unreachable |
| **Jev version** | read-only: "jev-latest → <version last seen>", the version S0 measured, and a notice when they differ (S-U10's guard) |
| **Consent** | S-U8 A explained: permissions last until the tab closes; nothing is remembered |
| **On-device backup** | status (installed / downloading / missing), size, **Download** / **Remove** per S-U2, and an on/off switch |

- **Where the key passes.** Typing a key into a page field means the key exists in the webview,
  briefly. The plan's boundary is therefore: **it crosses the webview once, at entry**: an
  uncontrolled password input (no React state), read once on Save, sent once to
  `semantic_key_set`, and the field cleared. It is never sent back to the page, never echoed,
  and never logged by the wrapper or the IPC layer. The stronger "never in the webview" needs
  native entry, so it is a choice for the user:
  **S-U12. Key entry** (answered: A): **A.** the page field above (simplest, same pattern as other
  apps' settings); **B.** a native prompt from Rust (on macOS an `NSAlert` with a secure text
  field, on Windows a Credential UI prompt); the key never touches the webview, at the cost of
  per-platform native code. Decided in S1.
- **The key is never** in `config.json`, preferences, drafts, the log (rule 20), MCP responses,
  crash output or the clipboard. Tests assert that for each.
- **The non-secret settings** are a new preferences group, `semanticSearch`:
  `cloudEnabled` (default `false`), `backupEnabled` (default per S-U2: `true` if bundled, `false`
  until downloaded), and S-U8's consent mode. The credential is not in this group.
  - **Load:** `#[serde(default)]` on the group and each field, so a config without it, or with
    unknown fields, loads to defaults without touching other groups; `UserPreferences::default()`
    (`src-tauri/src/models/preferences.rs:892`, hand-written) gains the group.
  - **Write:** not through `set_preferences`, whose `merge_preferences` replaces nested groups
    wholesale (`src-tauri/src/services/preferences.rs:169`), so a stale window writing
    `backupEnabled` would also restore an old `cloudEnabled`. Instead a dedicated
    `semantic_settings_update(patch)` takes a **field-level patch** (every field optional),
    applies it under the preferences write lock, persists, and returns the whole group;
    `PartialPreferences` (`services/preferences.rs:16`) doesn't carry the group, and
    `merge_preferences` (which builds a full `UserPreferences` literal) carries it forward
    unchanged with `semantic_search: current.semantic_search`, so the general path can't
    overwrite it.
  - **Ordering:** the group has a `revision`, incremented by every successful
    `semantic_settings_update`; the command's reply and the event both carry it, and the section
    applies a snapshot only if its revision is higher than the one shown, so an older reply or
    event arriving late can't overwrite a newer group.
  - **Propagation:** after a write Rust emits `preferences:semantic-changed` with the group to
    every window (a second new event for CLAUDE.md's table). Turning `cloudEnabled` off bumps the
    app epoch inside the same `JevState` transition as the write (S1b), not after it.
  - **The page:** the section has its own single-flight guard (the Integrations page's existing
    lease is MCP-specific): a section that hasn't loaded the group can't write it; a failed write
    follows DESIGN.md's settings contract (`docs/design/mdpro-ui-new/DESIGN.md:723`): the error
    toast is the only signal and the switch rolls back. Inline text is kept for disabled
    controls and lasting states ("No key", "Backup not installed"). Rust reads `cloudEnabled` itself at search time, so
    a window with a stale copy can't send.
- **Keychain access** is a new dependency (the `keyring` crate, or the Security framework and
  Windows Credential Manager directly), decided in S1's ADR. If the keychain is unavailable, the
  key is not stored, the switch stays off, and the section says why; there is no plaintext
  fallback.

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
| **S0** | **Spike, throwaway; may run before v0.3.6 lands.** Branch `spike/semantic-find`. **Jev:** the same labelled set is run through `jev-latest` (the reported version recorded) with the user's own key (the fixtures are synthetic, never the user's documents; the key and the run need the user's word first). **The $1 ceiling is enforced by the harness:** it keeps a running cost ledger; before every request it reserves that request's worst case (UTF-8 bytes as the token bound × $0.042 / M tokens × (1 + the retries allowed)); it dispatches only while all reservations fit under $0.90, leaving a 10 % margin; concurrent requests reserve before they start; on reaching the limit it stops and the record lists every case not evaluated. Its estimate is compared with TypeSafe's reported usage where available, recording quality, latency per chunk, token counts and cost for each fixture size, Chinese and English separately. **Backup:** it measures each § 5.3 and § 4.4 candidate under each S-U4 runtime: WKWebView on the current macOS **and** on 13.1, WebView2 (version recorded), and Rust `ort`. Per combination: load time, ms per batch, peak memory, worker or IPC copy cost, installer growth, and the § 5.8 budgets. **Quality:** a labelled set split **by document** into three partitions: *tune* (prompting, windows, minimum lengths), *validate* (choosing the model, the reranker and § 5.4's threshold rule), and a *final test* partition that nobody looks at until the gate, model, rule and threshold are frozen and the user has approved S-U7. It is then evaluated once, and its numbers are the ones S1 records. Chinese and English are reported separately. Queries include paraphrases, questions, absent topics and negations. Reported: recall@5, first-hit accuracy, false "found" rate (on absent topics) and false "not found" rate (on present ones). **Definitions, frozen before any run:** the label unit is the unique block (`blockKey`), and results are deduplicated by `blockKey` before the top 5 is taken; recall@5 = |relevant ∩ top 5| / min(5, |relevant|) (capped, so a query with more than 5 relevant blocks can reach 1); first-hit accuracy = the top result is relevant (present queries only); false "found" = share of absent-topic queries with any result above the threshold; false "not found" = share of present queries with none; each is the mean over queries, per language. **Sample size:** at least 10 documents and 60 queries per language in the final test partition (40 present, 20 absent). The capped recall is a definition, not a change of S-U7's numbers; it is shown to the user with them. One reranker is tried as a second stage. **Proposed gate, per language, on the final test partition:** recall@5 ≥ 0.80, first-hit accuracy ≥ 0.60, false "found" ≤ 10 %, false "not found" ≤ 15 %. These are proposals for S-U7; the user may change them before the final evaluation, not after. Each engine is gated separately. If the backup fails, the user chooses between shipping Jev with no backup (the bar says "needs Jev" when it can't be used) and deferring; if Jev fails, S-U1 goes back to the user | spike branch only; the record goes in `docs/test/<date>-sem-s0-spike.md`, fixtures in `tests/manual-fixtures/sem-*.md` and a generator script for the 10 MiB files | none (spike) | none; feeds S-U2 to S-U4 and S-U7 |
| **S1** | **The ADR and the contracts** (ADR number from the delegator when written). It records S-U1 (quoted), the options weighed, the privacy cost and the new CLAUDE.md § Constraints wording (§ 5.13); S-U2 to S-U4 and S-U7 to S-U12 as answered; the backup model, its licence, delivery and runtime; and the new dependencies (keychain, and the runtime if any). It defines the types: `Occurrence`, windows (§ 5.2), literal entries (§ 5.4), the model manifest, the request and result tags (§ 5.5), the index states (§ 5.4), and the lifecycle owner, a `semanticFindController` per window; and on the Rust side the `JevState` / `SemMemory` interfaces, the command signatures per module, the error enum and the event payloads that S1b implements. On acceptance, the same commit updates CLAUDE.md § Constraints | `docs/adr/NNNN-…md`; `src/features/semanticFind/types.ts` | type-only (no tests, rule 10) | ADR **yes** |
| **S2** | Extraction and mapping (§ 5.2) | `src/features/semanticFind/extract.ts`, `mapToEditor.ts` (or the generalised TOC resolver) | Same Markdown → the same occurrence kinds, texts and grouping in both modes, and each `sourceRange` maps to the right text in each editor. Fixtures: a GFM table (a paragraph to Source's parser, rows here), nested lists, a list item with a nested list, a blockquote, links and images (alt text kept), a repeated paragraph (one key, two occurrences), a short CJK heading, an empty doc, and a 1 500-character CJK paragraph. Mapping: every mappable occurrence's PM range holds its text; a deliberately unalignable block follows the unmappable policy; a repeated paragraph next to a transformed or omitted block stays unmapped rather than mapping to the wrong copy (§ 5.2). Exclusions: a document with YAML front matter and inline and block HTML comments, edited in WYSIWYG, switched to Source and back, and reloaded — the **outgoing request body** never contains a front-matter line or a comment, and a code block containing `<!-- -->` is sent as code. Windows: a block over 24 000 bytes gets Jev windows with the backup absent. Extraction: runs in the extraction worker; a cancel during the parse terminates it and the next run starts fresh; ten cancels in a row during a parse that never returns leave `SemMemory`'s reservations at their baseline, and the eleventh run completes; an old generation's release doesn't free the current one; admission refuses an oversized text before posting. Front matter: after a WYSIWYG edit turns it into a heading, the next Jev search for that document falls back with the "can't be separated safely" reason and sends nothing. Composition: the parity fixtures produce the same tree from `remarkComposition.ts` and from Milkdown. Alignment: a 10 MiB short-line fixture aligns within the gap cap; a document that is one 5 MiB code block and one 5 MiB paragraph is copied out in slices of ≤ 8 ms each, and a cancel between two slices of the same block stops the copy; a paragraph of 50 000 differently marked inline nodes and a list 20 000 items wide are copied in slices of ≤ 8 ms, the last slice takes no longer than the first (no prefix rescan), and a cancel inside either stops the walk before the next 256 nodes. Files: `tests/semantic-find-extract.test.ts`, `tests/semantic-find-map.test.tsx` | none |
| **S3** | The inference service under S1: package load with the manifest check, tokenizer-aware windows, pooling and normalisation per the manifest, batches, cancellation, and the worker or the Tauri command. If Rust: the command returns `Result`, validates count and total size, is registered in `commands/mod.rs`, and has its wrapper in `src/services/semanticFindService.ts` (rule 50 § 2) | `src/features/semanticFind/worker.ts` or `src-tauri/src/commands/semantic/backup.rs` + service, `src/services/semanticFindService.ts` | Mocks only at the worker port or `invoke`. Error paths: a missing file, a hash mismatch, a cancel mid-batch, an oversized input, a worker crash with one restart. A fixed fixture gives the same vectors (within a tolerance) from S0's reference output. A relevant sentence at the **end** of a long CJK block is found, because windows cover it. No-network test (§ 5.6). Logging pairs carry no text. Rust: input validation and the error type. Files: `tests/semantic-find-service.test.ts`, `tests/semantic-find-offline.test.ts`, and `#[cfg(test)]` in `semantic/backup.rs` if Rust | a row for the command, if any |
| **S4** | Ranking and index state, pure: the two tiers, the threshold rule from S1, verdict states, limits and LRU (§ 5.7) | `src/features/semanticFind/rank.ts`, `indexState.ts` | A low-similarity literal hit outranks a high-similarity semantic-only one; ordering is deterministic on fixed vectors; there is no "nothing" verdict while the index is partial; "nothing" appears only on complete coverage with everything below the threshold; limit and eviction boundaries are tested just below, at and above each limit. Files: `tests/semantic-find-rank.test.ts`, `tests/semantic-find-index-state.test.ts` (`// @vitest-environment node`) | none |
| **S5** | The controller and lifecycle (§ 5.5): per-window ownership, tags, accepting or dropping results, disposal on tab close, incremental re-index on edit | `src/features/semanticFind/controller.ts` (a `useSemanticFind` hook if needed) | Delayed completions across each transition (edit, reload, MCP write, mode switch, tab close, editor rebuild) are dropped and logged `stale`; a closed index is not revived; a completion inside the 200 ms gap after a WYSIWYG edit is dropped (§ 5.5); a late completion after disable or model removal neither reloads the model nor recreates an index; an edit re-embeds only changed `blockKey`s; two windows don't share or cross results. File: `tests/semantic-find-controller.test.ts` | — |
| **S-FM** | **Front matter through WYSIWYG** (§ 5.2), checked first, before S2. Step 1: does a WYSIWYG edit + save + reopen keep YAML front matter byte-exact? If yes, record it with its test and close S-FM. If no, report it to the delegator as a defect (a D number is the delegator's), and fix it here: front matter kept as its own node through Milkdown (parse, edit elsewhere, serialise), round-tripping byte-exactly | `src/plugins/milkdown/` (a front-matter node and its remark transform, joining `remarkComposition.ts`) | A document with front matter, edited in its body in WYSIWYG, saved, reopened: the file's front matter is byte-identical; editing the front matter's own text (if the node allows it) round-trips; the TOC and scroll-anchor counts that assume "hr + setext h2" (`anchor.ts:26`, D14) are updated with it. File: `tests/frontmatter-wysiwyg-roundtrip.test.tsx` | ledger row (WYSIWYG) if behaviour changes |
| **S1b** | **The Rust semantic core, first**, so the parallel items build on it: `JevState` (grants, both epochs, the rejected-key flag, the cool-down, the request registry), `SemMemory` (§ 5.7), the window `Destroyed` hook, the `semantic:auth-changed` event, and the command modules split one per owner: `src-tauri/src/commands/semantic/{search.rs, consent.rs, key.rs, settings.rs, memory.rs}`. **One ordered transition:** `JevState` is the outer lock and the preferences lock the inner one, never the reverse. `semantic_settings_update` takes `JevState`, then persists under the preferences lock, updates `JevState`'s cached `cloudEnabled`, bumps the app epoch if cloud went off, and only then releases `JevState`. Dispatch reads `cloudEnabled` from that cache under `JevState`, so a search can't see a newer "on" before an older "off" has fenced its grants. No code takes `JevState` while holding the preferences lock | `src-tauri/src/services/jev/state.rs`, `src-tauri/src/services/semantic_memory.rs`, `src-tauri/src/commands/semantic/mod.rs`, `main.rs` (the hook) | Rust: epoch bumps are monotonic and ordered under the lock; `Destroyed` removes the window's grants, cancels its requests and releases its reservations; a stale grant is refused; two windows reserving at the limit get a consistent eviction; a barrier-controlled test of off persisted → on persisted → search → (formerly delayed) off epoch bump dispatches nothing under the old grant; no path takes the locks in reverse (a test that would deadlock otherwise). Files: `src-tauri/src/services/jev/state_tests.rs`, `src-tauri/src/services/semantic_memory_tests.rs` | ADR (from S1) |
| **S-C1** | Keychain store and key commands (§ 5.12, § 5.14): `semantic_key_set` / `_remove` / `_status` / `_test` | `src-tauri/src/services/jev/key_store.rs`, `src-tauri/src/commands/semantic/key.rs`, `src/services/semanticFindService.ts` | Rust: set → status `set`; remove → `not set`; an unavailable keychain gives a typed error and stores nothing; status and every error never contain the key; the log lines for set/remove/test carry no key (a log-capture test). Test against a mock keychain backend at the crate boundary. TS: the wrapper never logs its argument. Files: `src-tauri/src/services/jev/key_store_tests.rs`, `tests/semantic-find-key-service.test.ts` | ledger row for the commands; ADR (from S1) |
| **S-C2** | The Jev client (§ 5.12): request building, both context limits, retries, deadline, app-wide concurrency, cancellation registry, transport policy, response validation, the error enum | `src-tauri/src/services/jev/client.rs`, `request.rs`, `validate.rs` | Against a local mock HTTP server: each packing bound (200 blocks; 24 000 state bytes; state + Σ qᵢ ≤ 60 000; state + max qᵢ ≤ 30 000) below / at / above, with a 200-character CJK query; the 400-split-once then `TooLarge`; a single block over the bound is windowed; a `400` context error splits once; every status in § 5.0's table maps to its enum; `Retry-After` honoured; the 20 s deadline; at most 4 in flight across two windows; a terminal chunk failure cancels siblings; `semantic_jev_cancel` stops queued, retrying and active requests; retries count against the cap; malformed `2xx` (missing / duplicate / unknown ids, NaN, 1.2) → `InvalidResponse`; a `3xx` to another host or `http:` is refused and nothing is sent onward; the body has no path or title and only S-U9's text; error values hold no key or text. Files: `src-tauri/src/services/jev/client_tests.rs` | ADR (from S1) |
| **S-C3** | Engine choice, consent and fallback (§ 5.0, § 5.13): the consent commands on S1b's `JevState`, the progress channel, and the frontend controller | `src-tauri/src/commands/semantic/consent.rs`, `src/features/semanticFind/engine.ts`, `consent.ts` | Rust: a direct `semantic_jev_search` without a grant → `NotAuthorised`, no request; a grant from window A doesn't authorise window B; revoke during a search cancels it and the epoch drops its late completion even after a re-enable; re-check before a retry stops a revoked search; a one-shot grant is consumed once and expires; a grant answered after a key change is `StaleGrant`; key removal in window A cancels a search in window B (via `semantic:auth-changed`); local-only set in Rust refuses a direct search; the breaker counts `Partial { cause: Timeout }`; a grant carrying the pre-revoke `grantEpoch` (prompt opened, document revoked, prompt answered) is `StaleGrant`, and so is one after tab close; an older `semantic:auth-changed` arriving after a newer reply is ignored. Frontend: every row of § 5.0's table and rules 1–10: each condition false → backup with its reason; cool-down after 3 failures and its expiry; `401` until the key changes; no mixed-engine results; "On this Mac only" never calls Jev; revoke and switch-off abort in-flight requests; a late Jev completion after revoke is dropped; Jev works with the backup off or missing; buffered Jev hits never show before completion; restricted coverage is named in a "nothing" verdict; literal hits in excluded blocks, short lines and past the § 5.7 limit still show, with both engines unavailable too; a block with literal and semantic hits appears once; progress messages from a stale or cancelled request are ignored; two windows reserving memory at the limit get one eviction, acknowledged. Files: `src-tauri/src/services/jev/state_tests.rs`, `tests/semantic-find-engine.test.ts`, `tests/semantic-find-consent.test.ts` | — |
| **S-C5** | The `semanticSearch` preferences group (§ 5.14), wired end to end | a new `src-tauri/src/models/semantic_search.rs` (the group and its defaults); in `preferences.rs` one `#[serde(default)]` field and the `UserPreferences::default()` line (the file is far past 300 lines, so nothing else goes there); `semantic_settings_update` in `src-tauri/src/commands/semantic/settings.rs`; `merge_preferences` in `src-tauri/src/services/preferences.rs` (carry the group forward); `src/types/preferences.ts`; `src/services/semanticFindService.ts` | Rust: defaults (`cloudEnabled` false); a config without the group or with unknown fields loads without losing other groups; a `set_preferences` call can't change the group; window A turns `cloudEnabled` off; window B, still showing it on, then patches only `backupEnabled`; `cloudEnabled` stays off; `cloudEnabled` off bumps the app epoch and emits both events; the credential never appears in serialised preferences. TS: an unhydrated section can't write; a failed write reverts the switch; a `preferences:semantic-changed` from another window updates the section; out of order (revision 5's event, then revision 4's reply) the section keeps revision 5; a general `set_preferences` leaves the group byte-identical. Files: `src-tauri/src/models/semantic_search_tests.rs`, `tests/semantic-find-preferences.test.ts` | ledger row (settings) |
| **S-C4** | The Integrations section (§ 5.14) as the user picked it in S-P; S-U12's key entry | `src/components/common/settings/SemanticSearchSection.tsx`, `IntegrationsSettings.tsx` | Component tests (ARIA, `userEvent`): switch disabled without a key and its reason; Save clears the field and shows "Key stored"; Remove; Test outcomes; the input is uncontrolled and cleared after Save; the key never appears in the DOM after Save, in any log call, or in any IPC reply. File: `tests/semantic-find-settings.test.tsx` | ledger row for the section |
| **S-P** | **Prototype, throwaway**: § 5.9's options, including the Integrations section, the consent prompt, the engine attribution and the indicator, on `prototype/sem-find`, after D255-WI-3c's popup exists; the user picks (S-U5, S-U6) | the prototype branch | none (prototype) | the verdict is committed on the branch; the delegator updates DESIGN.md |
| **S6** | The find bar as the user picked it: the command in the command table (S-U6's key, through K1–K8), the bar or popup mode, progress, verdict states with the engine and reason (§ 5.0), the indicator, "On this Mac only" and "Stop sending", stepping. (Settings is S-C4 / S-C5.) | the find popup's files from v0.3.6, `src/features/semanticFind/SemanticFind*.tsx` | Component tests (ARIA, `userEvent`): open, type, debounce, a stale result cancelled by new input, Enter / Shift+Enter cycling, Escape closes and clears, each verdict state rendered with its engine and reason, the indicator shown only while a Jev request is in flight; the key reaches the command once in both modes through the composed keymaps. File: `tests/semantic-find-ui.test.tsx` | a new row "语义查找", `Partial` with `限制：` until S8 |
| **S7** | Highlights and navigation in both editors, in **the style the user picked**: PM decorations in WYSIWYG, CM decorations in Source, the current hit scrolled into view, ticks if v0.3.6 has them | `src/features/semanticFind/decorations.ts` | Decorations follow edits (an edited hit block moves or drops), a mode switch re-maps or closes cleanly, and the dirty flag never changes. File: `tests/semantic-find-decorations.test.ts` (extracted decoration logic, rule 10 § plugins) | — |
| **S8** | Packaging per S-U2 (bundled, or the download with progress, retry, hash check and removal), recovery (§ 5.10), and the cold-start offline release check | the release workflow config, Settings, `src/features/semanticFind/package.ts` | Download (if chosen): a hash mismatch, an interrupted download, and no network each give a clear message, and regular find still works. Removing the model during a search gives the missing-model state. Removal with a completion pending doesn't recreate anything. Installer size is measured in the release build. Offline cold start on both platforms. File: `tests/semantic-find-package.test.ts` | ledger row to `Shipped`, or `Partial` with its limit |

**Order:** S0 (any time after its implementation grant; the Jev run is approved, S0-Jev) → the user
answers S-U2 to S-U4 and S-U7 → S1 (ADR accepted, CLAUDE.md updated; it defines the Rust
interfaces and the managed state as well as the TS types) → **S-FM** (front matter through WYSIWYG; gates S-C3's Jev path) and **S1b** (the Rust core) → [v0.3.6's
D255-WI-3c and M1b on `master`] → S2, S3, S4, S-C1, S-C2 and S-C5 in parallel, each in its own
command module → S5 with S-C3 → S-P → S6, S-C4 → S7 → S8.

### 6.1 Device checks

| Platform | How | What | Failure |
|---|---|---|---|
| macOS (current, Apple Silicon) | dtrack brief, batch "find" | Both modes, both themes: S0's held-out queries, where first-hit accuracy and absent-topic rates meet S-U7's gate. A partial index never shows "nothing". ⌘F stays literal. Typing while indexing the 1 MiB fixture meets § 5.8. Offline cold start: the model loads and searches with the network off. `nettop` shows no connection during a search | below the gate; "nothing" shown on a partial index; any outbound connection; typing over budget; the document marked dirty |
| macOS 13.1 | A macOS 13.1 VM or spare machine. If none can be found, S-U4 A stays unselectable (S-U4) unless the user accepted the capability-check route; that acceptance is quoted in the ADR | The runtime S1 chose loads, or the capability check shows its "unsupported on this macOS" message and regular find works. mdpro's OS minimum isn't silently raised | a crash, a silent failure, or no evidence at all for the chosen route |
| Windows | `remote-windows-device-test` skill, CDP page shots | Same queries; the model loads from where S-U2 put it; WebView2's own find doesn't fight the key (U11) | as on macOS |
| Jev path (macOS and Windows) | same briefs, with a test TypeSafe key the user provides for the run, on synthetic fixtures | Switch off → no request (proxy or `nettop` shows no connection to `api.typesafe.ai`); on, no consent → prompt; "Search on this Mac instead" → no request; allowed → indicator visible while sending, verdict "Jev (cloud)"; network off → "On this Mac · Jev unreachable"; a bad key → "Jev key rejected"; the key is absent from `config.json`, `~/.mdpro/mdpro.log` and the page DOM; it is in Keychain / Credential Manager | any request without consent or with the switch off; any key text on disk outside the keychain or in the log; a fallback without its reason; mixed-engine results |
| Linux | not available | untested (menu plan D6) | — |

## 7. Risks

| Risk | Note |
|---|---|
| Privacy | Document text leaves the machine. Bounded by the switch, the key, per-document consent, S-U9's exclusions and the indicator; what TypeSafe keeps for ordinary keys is not stated (§ 9) |
| Key leak | A key in a log, a crash report or `config.json` is a credential leak. Keychain only, with tests per surface (§ 5.14) |
| Cost | Every search re-sends the whole document: a 10 MiB document is millions of tokens per query. Bounded by S-U11's cap |
| Vendor change | TypeSafe can change the API, pricing, versions or terms; the waitlist may gate keys. The backup keeps the feature working. With `jev-latest` (S-U10) a version move can shift quality and the threshold silently; the guard surfaces it and triggers a re-run of S0's set |
| Chinese accuracy on Jev | TypeSafe says CJK is less accurate. S0 measures it separately; if Jev fails the gate for Chinese only, the user may choose the backup for Chinese documents |
| Backup quality below expectation | A 24–118 MB embedding model (or the 0.6 B JevEmbed) is weaker than Jev. S0's gate decides; if it fails, the user chooses between Jev-only and deferring |
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
5. **An enterprise / zero-retention key:** if the user has one, the consent text could say so;
   that needs TypeSafe's Legal page read in full (§ 9).
6. **Distilled community models** (`autotrust/JEV-*`): excluded. TypeSafe's agreement restricts
   distillation from its output, so a model distilled from Jev is not adopted even if a small one
   appears.

## 9. What this plan could not verify

- **Jev's latency and quality on mdpro's documents:** TypeSafe publishes pricing and its own
  latency claims, but nothing was run: a run needs the user's key and sends text to the cloud.
  Its architecture and size are unpublished.
- **TypeSafe's retention for ordinary keys:** the legal pages give general retention criteria and
  enterprise zero retention, but no fixed period for ordinary requests (checked in review).
- **Whether `typesafeAI` on Hugging Face is TypeSafe's own account:** unverified (no badge). It has
  no models either way.
- **The community models' claims** (JevEmbed's 94.4 % `noul` accuracy, open-jev-deberta's ECE)
  are their authors' numbers on their own test splits.
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
- Open-weight search (2026-10-16): Hugging Face API `models?search=jev` and `?author=typesafeAI`,
  the org page <https://huggingface.co/TypeSafeAI>, and the cards for
  <https://huggingface.co/HIT-TMG/JevEmbed-Qwen3-Embedding-0.6B>,
  <https://huggingface.co/com-kotobalabs/open-jev-deberta-v3-large> and
  <https://huggingface.co/autotrust/JEV-9B>; madewithjev.com "Is Jev open source?"; geotoolbox.ai
  "What Is Jev?".
- WebKit 16.4 release notes (WASM SIMD); ONNX Runtime Web docs (threads need cross-origin
  isolation; deployment artifacts); transformers.js custom usage (`allowRemoteModels`).
- mdpro: `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml:47` (`reqwest`),
  `src/components/common/IntegrationsSettings.tsx`, `src/components/common/SettingsDialog.tsx:52-61`, `src/components/Editor/extensions/search.ts`,
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
- **Revision 2 (S-U1 answered: C with a local backup).** Changed: the header, § 0 (S-U1 answered;
  S-U2 to S-U4 backup-only; S-U8 to S-U12 new), § 1, § 2, § 3.4, § 4.2 to 4.4 (Jev facts; the
  open-weight search), § 5.0 (engines and fallback), § 5.12 to 5.14 (the Jev client, consent and
  the constraint change, Settings → Integrations), WIs S-C1 to S-C5, § 6.1, § 7 to § 10. Scoped
  reviews with Codex `gpt-6.1-sol`, effort high:

  | Pass | Job | Result |
  |---|---|---|
  | changed sections | `review-plan-mvanutdh-bo9lf7` | NEEDS REVISION · Critical 0 · High 5 · Medium 8 · Low 3 |
  | confirm | `review-plan-mvao50z8-w3jvew` | 10 closed, 6 partial · C0 H3 M2 L1 |
  | confirm | `review-plan-mvaoaofb-2ergq3` | 4 closed, 2 partial · C0 H1 M1 L0 |
  | confirm | `review-plan-mvaoe323-6lnjj7` | **READY · Critical 0 · High 0 · Medium 0 · Low 0** |

  The Highs it found and how they closed: the key's path through the webview (now S-U12, with the
  boundary stated); Rust as the authority for sending (`JevState`, grants per window, re-checks
  before each chunk); cancellation as a command with a request registry and two epochs, with
  stale grants refused; both of Jev's context limits by actual encoded size; and a fixed
  HTTPS origin with redirects off. Mediums: an exhaustive outcome mapping with response
  validation; the breaker's unit and the search deadline; buffered Jev hits; "On this Mac only"
  separated from revoking; backup recovery scoped to the backup; the preferences group's
  wiring and ordering; three separate egress permissions; coverage named in the verdict. Lows:
  the agreement clause (§ 2.3(b)), the affiliation wording, the keychain wording.
- **Recorded where the reviewer could not check:** the reviewer couldn't fetch hunch's source. The
  author read it directly: `MAX_CHUNK_BLOCKS = 200` at `c220c73d`, while the README says 160.
- **Revision 3 (after the full review the user ran with `/cc-suite:review-plan`; the user's word:
  「Revise now (Recommended)」).** Full review `review-plan-mvaovec8-pad1aq` (thread
  `01a143c4-4bb2-7c92-8b5c-931d69370ec1`): NEEDS REVISION · Critical 0 · High 8 · Medium 7 · Low 0.
  The author checked the evidence before revising: front matter does become an hr plus a setext
  h2 in Milkdown (`anchor.ts:26`), a failed save is toast-only (DESIGN.md:723), `main.rs:299` has
  the `Destroyed` hook, and Jev's response carries a `model` field. Scoped confirms, Codex
  `gpt-6.1-sol`, effort high:

  | Pass | Job | Result |
  |---|---|---|
  | confirm | `review-plan-mvariz1u-dw4fuz` | 11 closed, 4 partial, 1 new · C0 H4 M1 L0 |
  | confirm | `review-plan-mvarpdak-hybx0b` | 2 closed, 3 partial, 1 new · C0 H3 M1 L0 |
  | confirm | `review-plan-mvarv0ux-8g90d9` | 3 closed, #9 partial · C0 H1 M0 L0 |
  | confirm | `review-plan-mvarxfqt-y82dzh` | #9 partial · C0 H1 M0 L0 |
  | confirm | `review-plan-mvarze6p-xdpve8` | #9 closed · **READY · Critical 0 · High 0 · Medium 0 · Low 0** |

  How the Highs closed:
  - **Extraction parity:** a worker-safe remark composition that matches the mounted editor's
    plugins, enforced by a test, with parity fixtures (§ 5.2).
  - **Memory:** a Rust `SemMemory` coordinator with admission before work (§ 5.7).
  - **Mapping:** fail-closed alignment that runs in the worker (§ 5.2).
  - **Main-thread cost (#9, the last to close):** the PM side is copied raw with a persistent
    cursor, the deadline and cancel are checked during the walk, text goes in 16 KiB pieces, and
    `nodesBetween` / `textBetween` are not used because they rescan prefixes.
  - **Front matter:** provenance is captured before parsing; Jev is not used when it is
    uncertain; new prerequisite WI **S-FM** checks whether a WYSIWYG edit and save keep front
    matter byte-exact.
  - **Lifecycle:** tab close revokes in the backend's `close_document`; the window's
    `Destroyed` hook cleans up; progress goes over a Tauri `Channel`.
  - **Ordering:** new WI **S1b** puts the Rust core first, with one lock order (JevState
    outer, preferences inner) and a barrier test.
  - **Version drift:** the response's `model` field; mixed versions are discarded and retried
    once (S-U10).
  Mediums: S0's metric definitions and the $1 harness; engine-specific windows; literal-match
  tiers; budget rows; the key-ownership table; DESIGN.md's failed-write pattern; the S-U9 wording.

