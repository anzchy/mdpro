# D167: the one-off `cargo fmt` of src-tauri, and what it cost the receipts

Evidence for [D167](../plans/20260912-frontend-backend-sequencing-order.md#d167).
User decision, relayed by mdpro-delegator: 「(a) 全量 fmt + fmt lane（推荐）」.
Delegator ruling (2026-10-12): full fmt, no `rustfmt::skip` and no ignore list;
the receipts it moves are a documented cost.

## What changed

1. `c552974` removed the retired `WatchOutcome::IgnoredRenameSinglePath`
   (never constructed since ADR-0078). Behaviour unchanged.
2. The fmt commit ran `cargo fmt --manifest-path src-tauri/Cargo.toml` on
   top of `c552974`: 38 files, all `*.rs` under `src-tauri/`, and nothing else.
   It also added the tdd-guardian `fmt` lane
   (`cargo fmt --manifest-path src-tauri/Cargo.toml --check`, gateOn commit,
   outside heavy-lock because it only parses).

## How "formatting only" was proved

Hashing the files with whitespace stripped is not enough: rustfmt also adds
trailing commas, re-sorts `use` / `mod` items, and adds or removes the braces
of a closure body or match arm. Each file was put in the narrowest class that
makes the base and the formatted text equal:

| Class | Equal after |
|---|---|
| `ws` | all whitespace removed (the sha256 columns below are of this text) |
| `ws+comma` | also removing a `,` directly before `)` `]` `}` |
| `reorder` | also comparing top-level `use` / `mod` items as a sorted set, with their `{…}` lists sorted |
| `brace` | also ignoring `{` `}` `,`. This is lossy, so these files were read by hand. The build, clippy and both cargo lanes are the backstop |
| `OTHER` | nothing above. This fails the proof |

Negative controls on the formatted tree: inserting one `!` into an `assert!`
in `file_watcher_seed_tests.rs`, and changing one string literal in
`file_watcher_log_event_tests.rs`, each came out `OTHER` with exit 1. A dry
run on `f3a358a` before the real run produced the same 38 files with the same
hashes.

Result: **16 `ws`, 14 `ws+comma`, 3 `reorder`, 5 `brace`, 0 `OTHER`**. All
8 non-`ws` files are test files. In the 5 `brace` files, 7 hunks differ beyond
whitespace and trailing commas, and each was read: 3 closure bodies `|x| e` →
`|x| { e }`, 2 match arms `=> e,` ↔ `=> { e }` (one each way), and one `use`
moved by `reorder_imports` in `confirm_stop_tests.rs` (two hunks).

| 文件 | +/- | 去空白 sha256(前) | 去空白 sha256(后) | 类别 |
|---|---|---|---|---|
| `src/bin/mdpro_mcp/conn_test_support.rs` | +5/-1 | `55d579ec5d33` | `a7a30ba7a708` | ws+comma |
| `src/commands/file_open_seed_tests.rs` | +48/-10 | `eacff0d518ce` | `eacff0d518ce` | ws |
| `src/commands/file_open_seed_watch_tests.rs` | +5/-1 | `26de2ee64526` | `26de2ee64526` | ws |
| `src/commands/file_open_seed_wiring_tests.rs` | +73/-16 | `c2ea979293ef` | `c44056f85275` | ws+comma |
| `src/commands/mcp_confirm_tests.rs` | +46/-11 | `e34716435f23` | `0f0286a24015` | brace |
| `src/commands/save_as_watch_tests.rs` | +23/-15 | `62e85e052e60` | `229fe8c353a5` | ws+comma |
| `src/services/app_exit_confirm_tests.rs` | +16/-5 | `b31ee3d671de` | `e5881d3e9be3` | reorder |
| `src/services/file_watcher_baseline_coherent_race_tests.rs` | +21/-5 | `d87bbfa55fac` | `cba30922d91c` | reorder |
| `src/services/file_watcher_baseline_coherent_tests.rs` | +17/-4 | `0c3f92201e1b` | `2145d8203bb6` | ws+comma |
| `src/services/file_watcher_baseline_gen_unchanged_tests.rs` | +8/-2 | `c5955a1ffc53` | `c5955a1ffc53` | ws |
| `src/services/file_watcher_baseline_lock_tests.rs` | +3/-1 | `c08f17697b26` | `c08f17697b26` | ws |
| `src/services/file_watcher_baseline_race_fixture.rs` | +14/-3 | `eb0d08a66080` | `eb0d08a66080` | ws |
| `src/services/file_watcher_baseline_read_tests.rs` | +60/-16 | `393516ee849f` | `ddc8b9b9679d` | reorder |
| `src/services/file_watcher_baseline_seed_tests.rs` | +9/-2 | `7efb485be601` | `7efb485be601` | ws |
| `src/services/file_watcher_log_event_tests.rs` | +16/-2 | `4396b38886d2` | `2794bcb17188` | ws+comma |
| `src/services/file_watcher_log_register_tests.rs` | +2/-8 | `a2cc13442d52` | `59fc10939bee` | ws+comma |
| `src/services/file_watcher_register_live_tests.rs` | +14/-4 | `ea81f3e0fd16` | `6d7b0d14e14e` | ws+comma |
| `src/services/file_watcher_seed_tests.rs` | +16/-4 | `298d94a27250` | `c0d4e36207fd` | brace |
| `src/services/mcp_confirm/broker_end_signal_tests.rs` | +20/-5 | `3d8afde5e56a` | `4f0cf819e28a` | brace |
| `src/services/mcp_confirm/broker_law_tests.rs` | +24/-5 | `6f2e8b87fad6` | `c95764aeecb2` | ws+comma |
| `src/services/mcp_confirm/broker_tests.rs` | +25/-5 | `72b06b5fd7b2` | `baedcc1a16ce` | ws+comma |
| `src/services/mcp_confirm/broker_time_tests.rs` | +5/-3 | `2cf812896e19` | `98382a1f7f43` | brace |
| `src/services/mcp_confirm/http_log_integration_tests.rs` | +22/-5 | `6c6895b865a8` | `6c6895b865a8` | ws |
| `src/services/mcp_confirm/http_tests.rs` | +35/-8 | `4ce483d343bf` | `ba5c7ca7bab7` | ws+comma |
| `src/services/mcp_confirm/lifecycle_tests.rs` | +10/-2 | `126e1f20413a` | `126e1f20413a` | ws |
| `src/services/mcp_confirm/logging_tests.rs` | +18/-3 | `a6a02d9f5af0` | `84ed72b2d71a` | ws+comma |
| `src/services/mcp_confirm/payload_tests.rs` | +5/-1 | `269881b07748` | `30b8b567c282` | ws+comma |
| `src/services/mcp_confirm/window_event_tests.rs` | +7/-2 | `fab259e83441` | `a9b6f593c7d3` | ws+comma |
| `src/services/mcp_controller/confirm_routers.rs` | +1/-2 | `f65058b6914d` | `f65058b6914d` | ws |
| `src/services/mcp_controller/confirm_stop_law_tests.rs` | +36/-9 | `0169dfd75910` | `0169dfd75910` | ws |
| `src/services/mcp_controller/confirm_stop_tests.rs` | +75/-21 | `3af8ac4c13d2` | `a5a0275a4814` | brace |
| `src/services/verify_run_guard_tests.rs` | +4/-1 | `eb7cffa7a0ee` | `eb7cffa7a0ee` | ws |
| `src/services/verify_run_instance_tests.rs` | +6/-3 | `d5c600ef6e52` | `d5c600ef6e52` | ws |
| `src/services/verify_run_publish_exec_tests.rs` | +40/-9 | `503e9a47cb9a` | `503e9a47cb9a` | ws |
| `src/services/verify_run_publish_fixtures.rs` | +14/-3 | `cf88599265a4` | `cf88599265a4` | ws |
| `src/services/verify_run_publish_law_tests.rs` | +5/-1 | `adf36b52367a` | `adf36b52367a` | ws |
| `src/services/window_restore_read_tests.rs` | +10/-4 | `545bab432bb6` | `734fecc22578` | ws+comma |
| `tests/updater_error_wire.rs` | +4/-1 | `a4842a332c10` | `a4842a332c10` | ws |

## What it cost the receipts

tdd-guardian fingerprints a specification file as its trimmed non-blank
lines, so re-indenting is harmless, but a wrapped or joined line no longer
matches. The plugin's own `fingerprintFiles` / `diffFingerprints` were run
against every receipt before and after each commit. The full lists are in
[`20261012-d167-receipt-lines.json`](20261012-d167-receipt-lines.json).

- **Already, before D167:** 83 receipts at `e5bf733` have at least one
  recorded file whose recorded lines are no longer intact, from later
  add-and-edit work. Their verdicts are sticky, so the fingerprint is a
  historical record, not a live gate.
- **`c552974` (variant removal):** 10 receipts now differ on the three
  edited test files (gate, log-event, route-law): D32-WI-2, D32-WI-4,
  D32-WI-4b, D32-WI-5, D32-WI-6, D32-WI-6b, D116-WI-1, D152-WI-1, D107-WI-1,
  D164-WI-1. Of these, only **D164-WI-1** did not already differ on those
  files.
- **The fmt commit:** 3 receipts gain differing files: **D86-WI-3** (6 more
  files), and **D109-WI-1** and **D69-WI-1**, which are new.

## For later readers of receipts.json

`receipts.json` cannot carry this note. tdd-guardian's `loadReceipts` and
`upsertReceipt` rebuild the store as `{schemaVersion, receipts}`, so an
extra top-level key is dropped on the next write. A receipt above that
fails `verify` on a `src-tauri` file because "a recorded line was changed or
removed" has this file as its explanation: compare against the class table
above before treating it as a moved specification.

**Never run `cargo fmt` over a file whose receipt is still unsettled**:
record its verdict first (the D69 receipt broke this way on 2026-10-11).
