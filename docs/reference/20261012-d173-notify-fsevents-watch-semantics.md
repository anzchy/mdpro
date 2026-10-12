# D173: notify 6.1.1 FSEvents watch semantics, the hold transitions, and the tests that pin the raw API

Evidence record for [ADR-0086](../adr/0086-a-save-tells-every-other-holder-and-the-watch-is-owned-per-canonical-group.md).
Written 2026-10-12 for D173 from plan r2 (mdpro-a6) and the Codex plan review
(`~/.mdpro-redesign/reviews/d173-codex-review-20261012.md`, BLOCK 5). The
notify line references below were re-read on 2026-10-12 against the pinned
source; the code references describe the tree at `f052b79`, before D173's
commits.

## 1. The pinned crate

`src-tauri/Cargo.lock:2541-2543` pins `notify` 6.1.1. Source read:
`~/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/notify-6.1.1/src/fsevent.rs`.

## 2. What `fsevent.rs` does

| Fact | Lines | Consequence for mdpro |
|---|---|---|
| `append_path` canonicalises the path (`:367`), appends the **raw** string to the stream's `paths` array (`:378`), and inserts **one** `recursive_info` entry under the **canonical** path (`:381-382`). | `:363-384` | Two spellings of one file give two stream paths and one filter key. |
| `remove_path` removes every array entry equal to the raw string under `kCFCompareCaseInsensitive` (`:336-349`, compare at `:338`), all duplicates included. | `:325-349` | On a case-sensitive volume, unwatching `Foo.md` also drops a distinct `foo.md`'s stream path. |
| `remove_path` then canonicalises (falling back to the raw path) and removes that `recursive_info` key (`:351-356`); a missing key returns `watch_not_found` (`:358`). | `:351-359` | Unwatching spelling A removes the key spelling B relies on. A second teardown call for the same group reports `watch_not_found`, which is expected. |
| The callback passes an event on only if its path `starts_with` a `recursive_info` key (exact match for a non-recursive key, or its parent) (`:517-534`); otherwise `continue`. | `callback_impl` `:494-545` | With the key gone, B's stream path still makes FSEvents report the file, but every event is filtered out. A raw-spelling holder keeps a baseline and loses delivery. |
| The callback builds the event path from FSEvents' `event_paths` (`:506-509`), not from the registered spelling. | `:506-509` | Events carry the real path. A document opened under a non-canonical spelling never matches `doc.path === event.path` (`externalChangeStore.ts`), before or after D173. That is D185. |
| The stream context holds a **clone** of `recursive_info` taken at `run()` (`:398`). | `:386-415` | The filter in force is the one captured when the stream last started. |
| `since_when` is fixed to `kFSEventStreamEventIdSinceNow` at construction (`:274`) and passed to every `FSEventStreamCreate` (`:415`). `watch_inner` and `unwatch_inner` each call `stop()`, change the path set, then `run()` (`:283-296`). | `:274`, `:283-296`, `:415` | Every `watch` / `unwatch` stops the stream and starts a new one from "now". Events landing during the restart are lost. A save notice must not depend on the save's own FSEvents event. |
| `stop()` stops the runloop and **joins** the runloop thread (`:309-321`); that thread runs the callback, which locks the event handler (`:541`). | `:304-323` | Anything that holds a lock across notify `unwatch` / `watch` must never be awaited by the callback, or `stop()` deadlocks. Hence ADR-0086 decision 2: the callback never takes the transition lock. |

mdpro's current path to notify `unwatch`: `close_document`
(`commands/file.rs:1511-1513`) → `FileWatcher::unwatch`
(`file_watcher.rs:127-141`) → `apply_watch` (`:178-192`). D106 kept B's
*baseline* across an alias unwatch (`file_watcher_baseline_claims.rs:52-69`),
not B's *delivery*; `d106_e` asserts the baseline only.

## 3. Hold transition table (plan r2 §3)

"Register" means the legacy register call: notify `watch(raw)` via
`apply_watch`, a watch-list push if the entry is new, the baseline store under
the D86 ticket rule (it overwrites, ADR-0068 d4), and for seeded registers the
D111 seed check. Every row logs one `file.watch.hold` or `file.watch.release`
line: `{transition, windowLabel, gen, groupConsumers, rawConsumers}`.

| # | Transition | Holders map | Raw layer (list, D106 claim) | Backend (notify) | Baseline | Reconcile (WI-4) |
|---|---|---|---|---|---|---|
| 1 | **First holder** (group absent) | insert `(W,R)→g`; group `{R:1}` | register: list push R, claim R→K | `watch(R)`; `notify_spellings=[R]` | seed / snapshot stored | none (no prior entry) |
| 2 | **Duplicate** (`(W,R)` held) | gen `g→g'`; counts unchanged; old gen now stale | register again: list no-op, claim re-stored | `watch(R)` again (array dup; `remove_path` removes all dups, `:340-349`) | overwritten after prior copied | compare prior vs stored |
| 3 | **Additional window** (`(W2,R)`, R held by W1) | insert; `R:2` | as 2 | as 2 | as 2 | as 2 |
| 4 | **Additional spelling** (R2, group held via R1) | insert; `{R1:n, R2:1}` | list push R2; claim R2→K (entry overwritten, D106) | `watch(R2)`; push R2 to `notify_spellings` | as 2 | compare; notices to R1 and R2 |
| 5 | **Registration failure** (notify `Err`) | hold kept | list updated anyway (legacy: "update the list whatever the Result") | Err logged on the register line as today; the next acquisition retries `watch` | stored (legacy: presence means registered) | still runs |
| 6 | **Acquisition refused** (W fenced) | nothing | nothing | nothing | nothing | none; reply `holdGen: null` |
| 7 | **Release** `(W,R,g)` | gen ≠ current → `Stale`, no-op. Else remove; `R` count −1 | count still >0 → `KeptRaw`; count 0, group non-empty → `unclaim(R)` (D106 release keeps the entry, bumps its gen) | group non-empty → **no notify call** | kept | — |
| 7b | **Release, group empties** | group removed | under T: re-check empty, then legacy `unwatch(R)` (list, baseline `remove_at`) | `unwatch(R)` first (removes canonical `recursive_info`), then `drop_notify_path(S)` for each other `S` in `notify_spellings` | removed | — |
| 8 | **Destruction** (`Destroyed` for W) | add W to `destroyed`; remove every `(W,*)` | per raw as 7 | per group as 7 / 7b | as 7 / 7b | — |
| 9 | **Late acquisition after Destroyed** | reserve → `None` (row 6); or the register raced the fence → `confirm_hold` finds the gen gone | `teardown_if_unheld` | the orphan `watch` is undone if the group is empty | an orphan store is removed (its ticket is newer, so `remove_at` with a newer ticket wins) | none |
| 10 | **Save As / rename retire old path** | frontend: after the path change, the subscription sees `P_old` unused in this window and sends `release_watch_hold(P_old, latestGen)` | as 7 | as 7 / 7b | as 7 | — |

Generations: Rust's `gen` is global and monotonic, starts at 1 (0 is never
issued), and the current gen of `(W,R)` is the last one reserved. The frontend
keeps a window-level `path → latest gen` map (`src/utils/watchHolds.ts`),
updated by every reply that carries `holdGen`, committed or not. A close racing
a reopen sends gen g while Rust already holds g+1, so the release is `Stale`.

## 4. Lock order

- **T → H** (brief): a reservation, confirm or release takes the transition
  lock T, then the holders map lock H.
- **T → watcher → list → L5** (baseline store): a teardown, through the legacy
  `unwatch` / `apply_watch`. T is held across the notify `unwatch` I/O.
- **A register** runs watcher → list → L5 with **no T and no H**.
- **H is a leaf**: never held while another lock is taken, no I/O, no
  `canonicalize`. Group keys and the prior-baseline copy are computed outside
  every lock. Poison is recovered, as for L5.
- **The notify callback** takes only L5 and the debounce map (and, if D185
  fans out by group, H as a leaf). It never takes T or the watcher mutex,
  because `stop()` (§2) joins the thread it runs on. `d173_wi1_k` pins this
  with a source tripwire.
- **The save notice** (`notice_saved`) takes only H, so it never waits on T,
  a register, or I/O.

## 5. Receipted tests that pin the raw API

These call the legacy `FileWatcher::watch` / `watch_seeded` / `unwatch` or
pin their call sites in production source, and carry tdd-guardian receipts
(ids from `.claude/tdd-guardian/receipts.json`, matched on `test_files`). The
legacy methods therefore stay byte-identical; D173 adds layered helpers beside
them, and production stops calling `unwatch` directly except as the last
spelling of a group teardown.

| Test file (`src-tauri/src/`) | Receipt ids | What it pins |
|---|---|---|
| `commands/save_as_watch_tests.rs` | D69-WI-1 | Save As registers the target; calls `fw.unwatch` directly as "close_document's unwatch" |
| `services/file_watcher_baseline_spelling_tests.rs` | D106-WI-1 | Two spellings, unwatch one; `d106_e` asserts B keeps its **baseline** (not delivery) |
| `services/file_watcher_baseline_gen_watch_tests.rs` | D86-WI-2 | watch / unwatch ticket order |
| `commands/file_open_seed_wiring_tests.rs` | D86-WI-3 | The open body has exactly one `watch_seeded(` with `seed` last, and no `.watch(` / `snapshot(` / `Entry {` |
| `commands/file_open_seed_tests.rs`, `commands/file_open_seed_watch_tests.rs` | D86-WI-3 | Seeded register behaviour |
| `commands/draft_recover_watch_roundtrip_tests.rs` | D86-WI-3 | Recovery's snapshot register and unwatch |
| `services/file_watcher_register_live_tests.rs`, `services/file_watcher_seed_tests.rs`, `services/file_watcher_log_register_tests.rs` | D86-WI-3 | Live register, seed, and the `file.watch.register` line |
| `commands/file_save_baseline_tests.rs`, `commands/file_save_burst_tests.rs`, `commands/file_save_wiring_tests.rs` (s5, s9) | D32-WI-6, D32-WI-6b | Save refresh under the self-write mark; `save_file_with(…, watcher.baselines())` |
| `services/file_watcher_baseline_wiring_tests.rs` (L9) | D32-WI-5, D32-WI-6, D32-WI-6b | The `Self {` initialiser slice up to the first `}` |
| `services/file_watcher_baseline_live_tests.rs`, `services/file_watcher_baseline_live_race_tests.rs` | D32-WI-5, D32-WI-6, D32-WI-6b | Live baseline and race behaviour over watch / unwatch |
| `services/file_watcher_fsevents_tests.rs`, `services/file_watcher_baseline_fsevents_tests.rs`, `services/file_watcher_observe_tests.rs` | D32-WI-4, D32-WI-4b, D32-WI-5, D32-WI-6, D32-WI-6b | Event routing over a registered path |
| `services/file_watcher_route_own_save_tests.rs` (os1, os2) | D101-WI-1 | The save's own event is `SelfWrite` / `IgnoredUnchanged`; D173 keeps that |

Also calling the raw API but **without a receipt** (free to adjust):
`draft_recover_watch_law_tests.rs`, `draft_recover_watch_tests.rs`,
`file_open_changed_tests.rs`, `file_watcher_baseline_live_race_l6b_tests.rs`,
`file_watcher_baseline_live_race_l8b_tests.rs`,
`file_watcher_seed_check_tests.rs`, `file_watcher_test_support_tests.rs`.

D173's own tests that pin the notify facts above (plan r2 §7, commit 1):
`d173_wi1_live_a_notify_canonical_removal_characterisation` (legacy `watch` A
and B, legacy `unwatch(A)`, external write, no callback event for B within
3 s; red by design), `d173_wi1_live_b_alias_release_keeps_delivery`,
`d173_wi1_live_c_reverse_release_keeps_callback`,
`d173_wi1_live_d_last_release_stops_delivery`, and
`d173_wi1_live_e_case_variant_canonicalises_to_one_group`.
