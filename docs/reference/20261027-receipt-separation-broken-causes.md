# Why receipts go SEPARATION-BROKEN, and how to fix the gate's false positives

Read-only research for ADR-0145 (issue #542 item 6), 2026-10-27, by a herdr-delegator research subagent, at master `c6d7a535`. Plugin paths are under the tdd-guardian 0.10.2 install.
Plugin: `~/.claude/plugins/cache/xiaolai/tdd-guardian/0.10.2/` (abbreviated `TG/` below). The 0.9.1
copy of `lib/verification.js` is byte-identical, and `scripts/tdd/red-receipt.mjs:76-82` always loads the newest installed version.
Scratch evidence: `align.js`, `align1.json` and `align-all.json` in this scratchpad directory. They hold an LCS of each BROKEN receipt's recorded line hashes against the first later commit of the file.

## 1. How the verdict is computed

**What is fingerprinted.** The tool hashes each whole spec file named at record time, nothing narrower:
- `TG/scripts/tdd-guardian/lib/verification.js:331-342`: the file text is split on newlines. Each line is `trim()`med, blank lines are dropped, and each remaining line is stored as a 16-hex sha256 prefix, along with a whole-file sha256.
- No line text is stored, so a BROKEN report cannot show what changed. Every exception below had to be reconstructed by hand.
- There is no notion of an assertion, a test case, an import or a fixture. Every non-blank line counts the same: imports, `vi.hoisted` mocks, helpers, fixture literals, and even production code when the "spec file" is a production file (`file.rs`, `window_focus.rs`, `image_pick.rs`).
- The file list comes from `--files` / `--test` (`TG/scripts/tdd-guardian/receipt.js:204-209`, `scripts/tdd/red-receipt.mjs:206-207`). The CLI refuses only unusable files (`receipt.js:228-235`) and files rewritten during the run (`receipt.js:243-251`).

**What flips the verdict.** `diffFingerprints` (`verification.js:378-414`) compares each file in four steps:
1. An identical sha means `unchanged`.
2. If every recorded line hash is still present in order (an ordered subsequence, `isSubsequence`, `verification.js:360-366`), the file counts as `extended`, which is info only.
3. Otherwise the file counts as `modified`.
4. A file that is gone counts as `removed`.

`verifyReceipt` (`verification.js:681-782`) maps these to findings:
- `modified` gives the High `spec-changed-under-green` (`:731-740`).
- `removed` gives the High `spec-deleted-under-green` (`:742-750`).
- A non-genuine RED gives the High `false-red` (`:700-707`).
- Any High gives SEPARATION-BROKEN (`:773-774`).

So **editing or deleting any single recorded non-blank line, anywhere in any named file, flips the verdict**. Inserting lines never does. Whitespace inside a line, such as a rustfmt line join, also changes the hash (only leading and trailing whitespace is trimmed).

**What does *not* flip it:**
- `implementation-already-present` is a **Medium** (`verification.js:718-727`; `dirty_source` captured at `:631-633`, `receipt.js:307-311`). It never makes a receipt BROKEN on its own.
- `weak-red` (opaque failure) is a Medium too (`:708-715`).

**Verdicts are terminal and first-shot:**
- `verifyAll` judges a receipt the first time its lane is green, then freezes it (`verification.js:805-818`, `TERMINAL_VERDICTS` `:64`).
- `red-receipt.mjs verify` refuses an already settled receipt (`:219`) and throws unless the result is HELD (`:240-242`).
- `discard` refuses a receipt whose recorded lines changed (`:256-261`, `:270-274`).
- `record` refuses an id that already has evidence (`:200-203`).

As a result, a transient edit that is later restored stays BROKEN for ever, and a corrected RED cannot replace the old one; it can only sit beside it, as with `D317-WI-1` and `-1b`.

**Enforcement:**
- `red-receipt.mjs check-pending` looks only at **`unit-red`** receipts that are not on master (`:279-287`).
- The landing verifier runs it and compares receipt records between parent and SHA (`.claude/agents/mdpro-landing-verifier.md:45-57`).
- Rust-lane and legacy `unit`-lane BROKEN receipts are therefore invisible to the gate; `M1b-progress.md` notes this for `M1b-WI-2-1`, `-2-2` and `-3-1`.
- In the other direction, a HELD receipt is never re-fingerprinted at landing. G518-2 (`D301-WI-1/2/3` are **HELD** in the store; their files were rewritten after settlement) and `D294-WI-1` ("post-settlement edits, including fixture replacement", `gpt-imple-2/D294-handoff.md:36`) were caught only by humans.

## 2. Census

`.claude/tdd-guardian/receipts.json` holds **710 receipts**, the same set as on master:

| Verdict | Count |
|---|---|
| SEPARATION-HELD | 623 |
| SEPARATION-BROKEN | 67 |
| unsettled (no verdict) | 20 |

RED kinds: 355 assertion-failure, 348 opaque-failure, 5 environment, 2 green.

| Lane | Receipts | HELD | BROKEN | Unsettled |
|---|---|---|---|---|
| unit | 363 | 341 | 21 | 1 |
| rust | 136 | 108 | 23 | 5 |
| unit-red | 204 | 167 | 23 | 14 |
| slow | 3 | 3 | 0 | 0 |
| rust-verify-run | 4 | 4 | 0 | 0 |

- All 67 BROKEN receipts carry the same blocking code, `spec-changed-under-green`. None is `removed` or `false-red`.
- 399 HELD receipts also carry `implementation-already-present`, which shows it is not what drives BROKEN.
- **Shared spec files are a risk factor.** Receipts that share a file with another receipt recorded within 24 h break 51/391 times (13 %). Solo receipts break 16/319 times (5 %).
- **38 BROKEN receipts are named by gate exceptions:** G519-1, G523-1, G522-1, G-M1b-1, G529-1, G528-1 (`D255-WI-3b-8b`), G531-1, G-D318-1, G-D319-1, G-D317-1 and G541-1 (`docs/audit/audit-log.md:72-88`).
- The other 29 predate the Gate-exceptions table; all were recorded by 2026-10-20.
- G518-2's three receipts are not BROKEN in the tool. They are HELD, with drift after settlement.

## 3. Classification of the 38 waived BROKEN receipts

Sources:
- each exception row (`docs/audit/audit-log.md:71-88`);
- implementor handoffs under `~/.mdpro-redesign/herdr-spike/` (cited);
- my hunk reconstruction (`align-all.json`).

| Class | Receipts | n |
|---|---|---|
| **(a) Assertion changed: true positive** | a1, weakened: `D318-F1-2` (a `nodeFromJSON` round trip removed from an assertion, audit-log:84). a2, re-specified by a requirement, ADR or code-shape change: `D299-WI-2` (ADR-0038 assertions changed under ADR-0127, `gpt-imple-2/D299-handoff.md:25`), `M1b-WI-2-1`, `M1b-WI-2-2`, `M1b-WI-2-5` (v1 expectations converted to v2), `M1b-WI-3-1` (host-aware menu layout) (`gpt-imple-1/M1b-implement.md:32`), `D319-F1-2` and `D319-F1-2b` (source-text scanner assertions follow the new `route_for_event(id, …)` call, `delegator/D319-receipt-exception-proposal.md`) | 8 (1 weakened + 7 re-specified) |
| **(b) Expected value was wrong, corrected** | `D317-WI-1` (off by one), `D318-F1-1` (`spread` value), `M1b-F1-4` (wrong expected toggle, `M1b-fix1-implement.md:18`), `M1b-WI-R8-1` (owner corrected to Strike, `M1b-progress.md:137`), `D269-WI-1-1` (jsdom `keyCode` plus tag oracle corrected, `M1b-progress.md:84`), `D267-WI-1-2` (no prose cause; the hunk shows the `toMatchObject({kind:"bound", chord:"Cmd+Shift+K"})` line changed) | 6 |
| **(c) Helper, fixture, setup or data-feeding change, assertions intact** | `D299-WI-1` (setup lines inside `file.rs`), `D294-WI-3` (8 hunks in `vi.hoisted` fake/`invokeMock`, 0 assertion hunks), `D302-WI-4` (outer harness drains early), `M1b-WI-11-1` (setup unassigns two bindings, `M1b-progress.md:88`), `D255-WI-3d-F1-1…4` (H3 fixture lines, `D255-WI-3d-handoff.md:226`), `D305-WI-7` (shared fixture returns and seeds revisions), `D322-F1-1` and `-2` (helper env delivery; 7 changed lines, 0 `expect` lines, `delegator/d322-verify-8e39b84.md:15-31`) | 11 |
| **(d) Mechanical refactor of test code** | `D255-WI-3d-F1-5` (hook seam moved from watcher to command-local reader), `D318-WI-1` (ProseMirror history import). G518-2's `D301-WI-1/2/3` (`spawnSync` → `await execFile`) are the same class but HELD (drift after settlement) | 2 BROKEN (+3 HELD) |
| **(e) Production already present at RED** | none as the cause. 30 of the 38 carry the Medium, but it never blocks (`verification.js:718-727`, `:773`) | 0 |
| **(f) Other: transient edit, or collateral edit in a shared file** | Transient and restored: `D299-WI-3` (import edited, then restored; my reconstruction finds 0 changed recorded lines at the next commit; `D299-blocked.md:21`), `D305-WI-3` (logging assertion edited, then restored). Collateral: `D255-WI-3d-F1-6` and `-7` (other assertions in the shared spec changed). Shared file, cause not written down: `M1b-WI-15-2`, `-15-3`, `-15-4` (four receipts share `m1b-source-basic-keys.test.tsx`) | 7 |
| **(g) System under test lives in the fingerprinted file** | `D302-WI-5` and `D302-WI-9` (runner or `checkedGit` implemented in the test file, `gpt-imple-1/D302-implement.md:15,53`), `D319-F2-1` (`window_focus.rs` production imports changed), `D255-WI-3b-8b` (`image_pick.rs`) | 4 |

**Totals:**
- (a) 8: 1 weakened, 7 re-specified;
- (b) 6;
- (c) 11;
- (d) 2, plus 3 HELD;
- (e) 0;
- (f) 7;
- (g) 4.

At most 8 of 38 (21 %) are true positives in the "assertion changed" sense, and only **1** (`D318-F1-2`) is an actual weakening.

Caveats:
- My regex for assertion hunks is unreliable. It missed `D267-WI-1-2`'s `toMatchObject` line and `D318-F1-1`'s multi-line expected literal. It compares against the next commit, not the exact tree at verify time.
- Across all 67 BROKEN receipts it gave 30 with an assertion-touching hunk, 30 without, and 7 with no changed recorded line at the next commit, which means the edit was transient.
- Class (c) is not harmless by definition. G541-1's helper edit dropped the `${{ }}` `replaceAll`, which left the shell-metacharacter case vacuous against the pre-fix workflow (accepted as an open Medium). The same edit made one RED self-referential: the `GITHUB_SHA` case tests fixture isolation, not product code (`d322-verify-8e39b84.md:24-30`).

## 4. Did a waiver hide a real defect?

No waiver is known to have hidden a defect, but the evidence is thin.

- **The escape record is empty.** `docs/audit/escapes.md:20-21` holds only the header row.
- **D319 is a defect escape that went unrecorded.** D319 Fix 2 landed under G-D319-1 (PR #533). B8 then failed on device: every 0 ms race acted in window B. That forced Fix 3 (PR #539, `32fa5b96`). The cause was AppKit ending menu tracking before WillSend, an event ordering no unit test modelled (sequencing doc, D319 row). The waived receipts' edits (scanner lines, `window_focus.rs` imports) did not cause it, and an intact receipt would not have caught it. The exception proposal had itself named this residual risk. Even so, it is a device-found defect in audited code and belongs in `escapes.md` (`escapes.md:3-6`).
- **D321 has no established link to the waived receipts.** It was seen once during B9's D305 step: the process ended after a secondary window's "Don't Save", with no `app.quit` line. It was not reproduced (0/5, B10). It sits in the area of G531-1 and G523-1, but the waived edits there were fixture and mock lines, and the decisive `D305-F2-1` is HELD.
- **G541-1's weakened case** was found and accepted openly as a Medium, not hidden.

## 5. Proposed tool changes

Ordered by value. Each estimate counts the 38 waived receipts.

**P0. Make BROKEN explainable.**
- Store, per spec file at RED, either the git blob id (`git hash-object -w`, which survives in the object database) or the compressed text.
- On BROKEN, print the recorded lines that changed, with their replacements.
- This converts nothing, but it replaces the hand reconstruction behind every exception, and it is required by P2 and P3.

**P1. Judge at the end, not on first green.**
- Allow `verify` to re-run on a BROKEN, unlanded receipt, and turn it HELD only if every recorded line is present again. This is monotone: no assertion edit can pass this way.
- At landing, the verifier re-fingerprints **every** receipt the branch added, HELD included, against the SHA.
- Converts the transient cases: `D299-WI-3`, plus `D305-WI-3` together with P2 = **2**. It also closes the G518-2 and D294-WI-1 blind spot, which makes the gate stricter, not looser.

**P2. Fingerprint the specification, not the file.**
- Parse the spec files (TS through the compiler API; Rust through `syn`, or a rule based on balanced macro bodies) into three groups:
  1. **assertion extents**: the whole `expect(…)…matcher(…)` chain including multi-line arguments; `assert!`, `assert_eq!`, `assert_ne!`, `panic!` and `#[should_panic]`;
  2. **case identity**: test titles and `#[test] fn` names;
  3. everything else, the **support**.
- A changed line in groups 1 or 2 stays High (BROKEN).
- A change only in support becomes a new Medium `spec-support-changed`, with verdict HELD-with-note, and needs P3 to settle.
- Regexes are not enough; see the misses in §3.

**P3. Replay the RED automatically (re-RED).**
- At record time, also snapshot the non-test tree (`git stash create`, or a temp-index `write-tree` holding `dirty_source`). Store the snapshot's tree id and the failing test ids, from vitest's JSON reporter or libtest names.
- At verify time, when only support changed, check out a temporary worktree containing the RED-time production tree and the **current** spec and support files.
- Require an `assertion-failure` on the same failing test ids.
- This automates what humans did by hand for G-M1b-1 (base-tree and mutation proofs), G529-1 (base proof), G541-1 (revert experiments) and G522-1 and G523-1 (the R receipts).
- It would have flagged G541-1's `GITHUB_SHA` RED on its own: with the fixed helper, that case passes against RED-time production.
- Limit: the replay is unbuildable when the final spec imports symbols added after RED. 6 of M1b's 10 base proofs failed on import or compile (`M1b-receipt-substitute-proofs.md`, table). Those fall back to PENDING plus a human ruling.
- **P2 + P3 convert (c) 11 + (d) 2 = 13**, and the 3 HELD G518-2 receipts stop needing a waiver. Class (a) cannot pass: its assertion-extent lines changed.

**P4. A `supersede` verb for class (b), instead of a waiver.**
- `red-receipt.mjs supersede --id X --by Y` accepts Y when all of these hold:
  - Y is a fresh assertion RED on the same spec files;
  - Y's RED-time production snapshot (P3) is unchanged for the system-under-test paths since X's RED, which proves the RED did not see the fix;
  - Y's failing ids include X's changed cases.
- X becomes `SUPERSEDED`: terminal and not blocking, keeping the assertion diff as evidence for the auditor.
- Today `D317-WI-1` stays in the store, because `discard` refuses changed records (`red-receipt.mjs:256-261`).
- Converts (b) **6**.
- The same verb, with the assertion diff required in the record, gives the 7 re-specified (a2) receipts a reviewable path. They should still need an auditor or user decision, because the expected behaviour itself changed.

**P5. Refuse production files as specs.**
- At record time, reject any `--test` or `--files` path that is not a test file. A Rust source file with an inline `#[cfg(test)]` module is fingerprinted only within that module.
- For TS tooling tests, require the system under test to live in an imported module.
- Converts (g) **4**: `D302-WI-5`, `D302-WI-9`, `D319-F2-1`, `D255-WI-3b-8b`.

**P6. Scope by case in shared files.**
- Fingerprint only the cases that failed at RED, plus the support they reach.
- This addresses the 13 % against 5 % break rate for shared files.
- Converts collateral (f): `D255-WI-3d-F1-6` and `-7`, and probably `M1b-WI-15-2`, `-15-3` and `-15-4` = **2 to 5**.

**P7. Close enforcement gaps** (stricter, not looser).
- `check-pending` covers every lane, not just `unit-red` (`red-receipt.mjs:281`).
- The landing re-check from P1.

### Net effect on the 38 waived receipts

| Outcome | Classes | Receipts |
|---|---|---|
| Automatically HELD | (c) 11, (d) 2, (g) 4, transient (f) 2, collateral (f) 2 to 5 | 21 to 24 |
| SUPERSEDED | (b) 6 | 6 |
| Still BROKEN | the 8 of class (a) | 8 |

Of the 8 still BROKEN, the 7 re-specified receipts get a reviewable supersede record, and the 1 weakening (`D318-F1-2`) needs a ruling. Gate-exception rows would fall from 10 to about 4 (G519-1, G-M1b-1, G-D318-1, G-D319-1), each smaller and each with the assertion diff attached.

**"Demote to evidence" as the alternative.** Without P2 and P3, demoting BROKEN to evidence means auditors judge diffs they cannot see (no stored text), and the single real weakening would pass on trust. If you demote, ship at least P0 and P7 so the evidence is legible and complete. The recommended path is P0 + P1 + P2 + P3 + P5, with P4 for (b): a narrow High that only an assertion change or a non-reproducing replay can trigger.
