# 0145. A broken RED receipt carries its own evidence, and the auditors rule on it before the user is asked

## Status

**2026-10-29: partially superseded** (decision 1's snapshot of the code under test; decision 2's re-RED target and print step; decision 3's digest contents, extended) by [ADR-0149](0149-a-broken-receipt-is-judged-by-a-base-tree-fail-to-pass-replay.md).

**Accepted, 2026-10-27.** Decided by the user: 「Accept (Recommended)」, after both auditors' scoped round 3
(C0 H0; `ADR-0145-r3.md`; opus-auditor's 5 Mediums go to the implementation brief). Recorded by herdr-delegator. Until
the entry described here ships, receipt exceptions keep the existing user path. Rule 10, rule 71's Rust line, the
rustfmt hook and the landing verifier's step 4 are amended in the implementing commit.

Proposed 2026-10-27, by herdr-delegator (Claude route), for issue #542 item 6. The user adopted the recommendation:
「建议1-7 均采纳，创建一个GitHub issue，然后开始做相关的改进」.

**Revised after plan review round 1** (gpt-auditor C0 H5 M2, opus-auditor C0 H5 M7 L2; reports
`herdr-spike/{gpt-auditor,opus-auditor}/ADR-0145-r1.md`). Both found that the first draft's automatic clearing could
not tell a weakened oracle from a harmless edit:
- a vacuous case;
- an expected value moved outside an `expect`;
- `supersede` used to weaken.

The tool now gathers evidence and never clears a receipt by itself.

**Round 2** (gpt-auditor C0 H3 M2, opus-auditor C0 H1 M4 L2; `ADR-0145-r2.md`) left three Highs, closed below
without a third round:
- **Both auditors:** the RED snapshot would have pushed untracked local files to the public repository.
- **gpt-auditor:** the rulings were not bound to the bytes they cleared.
- **gpt-auditor:** an inserted early `return` kept a receipt HELD.

The user decides under ADR-0143 decision 3.

**Partially supersedes, by name:**
- **[ADR-0125](0125-frontend-red-receipts-run-one-validated-test-file-not-the-full-coverage-lane.md) decisions 1–2.** The entry records
  more evidence and covers the Rust lane. The verdict set is unchanged: HELD or BROKEN. ADR-0125's "nothing else
  settles" stands.
- **[ADR-0129](0129-a-high-that-survives-the-audit-cap-is-classified-tracked-and-expires.md) decision 8, for one
  class only.** A BROKEN receipt that both auditors rule non-weakening, and whose re-RED passes, gets a gate-exception
  row with the auditors' rulings instead of a user ruling.
- **`.claude/agents/mdpro-landing-verifier.md` step 4, and rule 71's Rust receipt line.**

## Context

Measured on 2026-10-27. Evidence:
[`docs/reference/20261027-receipt-separation-broken-causes.md`](../reference/20261027-receipt-separation-broken-causes.md).

- **What gets hashed.** The plugin (tdd-guardian 0.10.2, third-party) hashes every non-blank line of each spec file at
  RED.
- **When a receipt breaks.** A receipt is SEPARATION-BROKEN when those lines are no longer an in-order subsequence
  of the file. No line text, failing test id, or production snapshot is stored. A BROKEN report cannot say what
  changed, and nobody can re-run the RED.
- **The numbers.** 710 receipts: 623 HELD, 67 BROKEN, 20 unsettled. Gate exceptions name 38 of the BROKEN ones:

  | Cause | Count |
  |---|---|
  | (a) An assertion rewritten (one real weakening, `D318-F1-2`) | 8 |
  | (b) An expected value corrected | 6 |
  | (c) A helper, fixture or setup change | 11 |
  | (d) A refactor | 2 |
  | (f) An edit later undone, or a collateral edit | 7 |
  | (g) Production code inside the hashed file | 4 |

- **Every waiver was hand-built.** Each one needed a hand-built substitute proof and a user question. The user is
  ruling on diffs nobody printed.
- **Holes.**
  - `check-pending` sees only the `unit-red` lane.
  - HELD receipts are not re-hashed at landing.
  - The Rust lane bypasses the repo entry.
- **Edits can make a case vacuous.** In G541-1 a helper edit left one case vacuous while the run stayed red. Any rule
  of the form "some test still fails" misses it.

## Options considered

1. **Keep waiving by hand** (today). Lost: the user rules on diffs nobody printed, and every proof is improvised.
2. **Demote BROKEN to evidence.** Lost: it removes the only signal that a RED was edited.
3. **Clear automatically by syntax and re-RED** (first draft). Lost in review. It cannot see:
   - an oracle moved into a variable, table, fixture or mock;
   - `it.skip`, an early `return`, or `#[should_panic]`;
   - a vacuous case;
   - a `supersede` that weakens.

   No parser is sound enough to clear without a reader.
4. **Upstream plugin changes only.** Lost as the sole path: the release is not ours to schedule.
5. **Capture complete evidence at RED, print it on BROKEN, re-run the RED as evidence, and let both auditors rule;
   the user rules only on a weakening, a disagreement, or what the auditors cannot settle.** Chosen.

## Decision

1. **Evidence at RED, for both lanes, through the repo entry.** Rust joins `scripts/tdd/red-receipt.mjs`; rule 71's
   direct `receipt.js` line is retired. The entry stores, keyed by receipt id plus its recorded-at time:
   - **the failing test ids** with their failure kind: assertion, panic, or compile/collect error. Vitest JSON full
     names; libtest names for Rust.
   - **a snapshot of the code under test at RED.** It holds:
     - every tracked file as it is in the working tree, dirty edits included;
     - untracked files only under `src/`, `src-tauri/src/`, `tests/`, `scripts/` and `.github/`;
     - never an ignored file, and never anything under `.claude/`, `.agents/`, `.codex/` or `.tokenize/`.

     The entry lists the untracked paths it took in the sidecar.
   - **The snapshot stays on this machine.** It is a commit object pinned under the local ref
     `refs/receipts/<id>/<recorded-at>`, so `gc` cannot prune it. It is **never pushed**: every worktree shares the
     mini's one object store, so the verifier and re-RED reach it locally. It is deleted 30 days after landing.
   - **the plugin version, the lane command and its environment.**
2. **On BROKEN, print and re-run; never clear.**
   - **Print.** The entry prints the recorded lines that changed, as a diff against the snapshot.
   - **Re-RED.** It then runs the current tests, with the receipt's own lane and selection, against the snapshot's
     non-test paths (everything except `tests/` and Rust `#[cfg(test)]` modules). The re-RED passes only when every
     RED-failing id fails again with an assertion failure, and none passes, skips or disappears. It fails closed in
     three cases:
     - the current tests cannot run against the snapshot (a missing symbol, a compile error);
     - the RED's recorded set holds no assertion-kind id;
     - the RED was a compile or collect error.
   - **The diff covers support files too.** The printed diff includes the whole `tests/` tree against the snapshot,
     so a changed support file or fixture is in the evidence.
   - **Output only.** The diff and the re-RED result go into a sidecar evidence file. **The verdict stays BROKEN.**
3. **The auditors rule, in round one.**
   - The audit request names every BROKEN receipt in the range, with its evidence packet.
   - **The packet is content-addressed.** Its digest covers:
     - the receipt id and recorded-at;
     - the snapshot commit id;
     - the current `tests/` tree id and the spec blob ids;
     - the re-RED output.

     Each auditor's ruling cites that digest.
   - Each auditor rules **non-weakening** (the oracle still demands at least what the RED demanded) or **weakening /
     re-specification**. A changed literal, table, fixture, mock return, skip, title, early return,
     `expect.assertions` or `should_panic` counts as an oracle change and is read as such.
4. **Who clears.**
   - **The auditors clear it** when both auditors rule non-weakening and the re-RED passed, both on the same digest,
     and that digest matches the branch head's `tests/` tree and spec blobs. The delegator checks the match under the
     evidence lock; a mismatch is re-audited.
   - **The gate-exception row** carries ADR-0129 decision 8's fields: id, gate waived, landing-only scope with PR
     and SHA, and owner. It cites the digest and both rulings in place of a user quote. There is no user question.
   - **The user rules** on anything else: either auditor reads a weakening, the auditors disagree, or the re-RED
     failed or could not run. The request shows the diff (ADR-0129 decision 8 as today).
   - There is no `supersede` verb. A corrected expectation is a class (b) BROKEN and takes this path.
5. **Close the holes.**
   - `check-pending` runs on every lane.
   - **The settlement fingerprint is the spec files' full blob ids,** not the RED line subsequence:
     - at the verify that settled a HELD receipt;
     - the digest's blobs for a cleared BROKEN one.
   - **The entry is stricter than the plugin.** Any spec-byte change between RED and verify, insertions included (an
     early `return` keeps every recorded line), runs decision 2, even when the plugin says HELD.
   - **At landing, the verifier compares blob ids** for every receipt the branch added. Any change re-opens the
     receipt into decision 2.
   - A rebase that brings a master edit into a branch's spec file is handled the same way.
6. **One lock, one schema.**
   - All sidecar writes, for every id and both lanes, take one repo-wide lock (`.claude/tdd-guardian/.evidence.lock`),
     and the sidecar records the plugin version.
   - A sidecar entry is written only after the plugin's own record succeeds. A missing, stale or mismatched entry is
     read as "no evidence" and fails closed to the user path.
   - New fields never go into the plugin's `receipts.json`.
7. **Production code inside a spec file (class g)** stays as is: a whole-file hash, with the diff printed and ruled
   under decision 3. The plugin cannot hash a `#[cfg(test)]` module alone, and a repo-side fingerprint that diverges
   from the plugin verdict would be a second source of truth.
8. **The rustfmt guard moves with the Rust lane.** Rule 10 § "Format before you record" and
   `.claude/hooks/receipt-rustfmt-guard.sh` name `receipt.js`. The entry runs the same `rustfmt --check` on the Rust
   spec files before it records, and both texts are amended to name the entry.
9. **Upstream.** With the user's word, decisions 1–2 are offered to the plugin's repository as an issue. Filing it is
   the user's call because it is outward-facing.

## Consequences

- **Gained.**
  - Every BROKEN receipt arrives with its diff and a re-RED.
  - The user is asked only about a real oracle change or a dispute. Judged by the evidence document, that is roughly
    the 8 rewritten assertions and the 6 corrected expectations (both re-specifications), plus disputes and re-REDs
    that cannot run: at least 14 against 38 today.
  - Hand-built substitute proofs end.
  - The Rust lane and post-settlement edits stop escaping the gate.
- **Costs.**
  - New code in `scripts/tdd/`, with tests: Vitest JSON and libtest parsing, a snapshot writer and pinning, a re-RED
    runner (temporary worktree under `scripts/heavy-lock.sh`, a fresh `pnpm install --offline` against the
    snapshot's lockfile, a full cargo build for Rust), and the sidecar lock.
  - Each BROKEN receipt costs a re-RED run, minutes for Rust.
  - Pinned refs add objects to the repo.
  - Auditors read more per round.
  - Re-RED will often fail to run where the final tests import symbols added after RED: 6 of M1b's 10 base proofs
    were unbuildable. Those cases still reach the user, now with the diff.
  - Closing the holes may surface BROKEN receipts that pass unseen today.
- **Foreclosed.**
  - Automatic clearing by any syntactic rule.
  - A user waiver for a receipt that both auditors read as unweakened with a passing re-RED.
