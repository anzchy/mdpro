# 0149. A broken RED receipt is judged by a base-tree fail-to-pass replay

## Status

**Proposed, 2026-10-29, by herdr-delegator (Claude route).** Partially supersedes, on acceptance, ADR-0145 decision 1's
snapshot, decision 2's replay target, decision 4's "the user rules on anything else" for a replayable receipt, and its
Status line's "until the entry … ships, receipt exceptions keep the existing user path".

The user asked 「针对上述问题，你的解决方案是什么，web search 查看最佳实践」 about recurring SEPARATION-BROKEN receipts, and
chose 「All three layers (Recommended)」 (2026-10-29): layer 1 (the verifier's manual replay) and layer 2 (brief changes)
**apply from that ruling**, before this record is accepted; layer 3 (the tool) waits for acceptance and plan review.

## Context

- The tdd-guardian receipt proves "the test failed before the implementation" by fingerprinting every non-blank line of
  each spec file at RED and comparing at the first green. Any edited or deleted recorded line is High
  `spec-changed-under-green`, and the verdict SEPARATION-BROKEN is terminal (`verification.js:734`, `:774`).
- The 2026-10-27 census (`docs/reference/20261027-receipt-separation-broken-causes.md`): 67 of 710 receipts BROKEN, all
  `spec-changed-under-green`. Of the 38 that gate exceptions name, **one** was a real weakening (D318-F1-2). The rest
  were corrected expected values, fixture, helper and import changes, edits undone, refactors and line-cap moves.
  Receipts sharing a spec file within 24 h broke at 13 % (51/391) against 5 % (16/319) alone.
- Each BROKEN receipt costs an evidence write-up and a user question: 17 exception groups from G519-1 to G-D331-2 and
  G-ADR0146-2; on 2026-10-28 alone D331-F1-1, RESET-UPD-F2-1, ADR0146-G1-1, D332-F1-1 and ADR0147-WI1-3.
- ADR-0145 (Accepted 2026-10-27) answers it with a snapshot of the code under test at RED (a local commit ref per
  receipt, a content-addressed evidence packet and a repo-wide lock), a re-RED of the current tests against that
  snapshot, and auditor clearing. As of 2026-10-29 nothing of it is implemented, and until it ships every exception
  still goes to the user.
- **Practice elsewhere** (web search, 2026-10-29):
  - SWE-bench grades a fix by **FAIL_TO_PASS** (the final tests fail before the fix and pass after) and
    **PASS_TO_PASS** (existing tests pass both before and after), always with the final test text
    ([OpenAI, SWE-bench Verified](https://openai.com/index/introducing-swe-bench-verified/)).
  - The .NET MAUI "verify tests fail without fix" check reverts the fix files to the base branch, runs the tests and
    requires failure, then restores the fix and requires a pass
    ([skill](https://tessl.io/registry/skills/github/dotnet/maui/verify-tests-fail-without-fix)); the red-green-red
    loop says the same ([joshka.net](https://www.joshka.net/practice/rules/testing/test-write-regression-tests-for-bug-fixes/)).
  - Test-tamper research finds that a file-change check on tests catches tampering at no cost but flags every
    legitimate edit and misses hard-coded outputs, so it is paired with a replay outside the agent's sandbox and a
    process review ([EvilGenie summary](https://api.emergentmind.com/topics/evilgenie)).
  - Mutation testing shows a test would fail on a wrong implementation, which red-green alone does not.

## Options considered

1. **Keep asking the user per BROKEN receipt** (today). Lost: 66 of 67 questions were about harmless edits; it does not
   scale and trains a rubber stamp.
2. **Implement ADR-0145 as accepted.** Lost: the snapshot ref, packet digest and evidence lock exist to keep the
   RED-time production tree reachable, which `git merge-base` already gives; more machinery to build and keep correct
   than the property needs.
3. **Fingerprint only assertions** (census proposal P2). Lost: still a text test; a moved assertion or a corrected
   literal still breaks, and a weakening outside an `expect` (a fixture, a mock return) passes unseen.
4. **Base-tree fail-to-pass replay, plus a pre-existing-assertion diff, plus auditor ruling.** Chosen: it proves the
   property that matters (the final test fails without this branch's production change and passes with it), with the
   final test text, which is what lands.

## Decision

1. **The replay.** For each BROKEN receipt the branch added, the landing verifier (layer 1, by hand; the repo entry
   once layer 3 ships):
   - in a detached verify worktree at the head, restores every **non-test** path to the PR base (`git merge-base`):
     everything except `tests/`, and for Rust the head's `#[cfg(test)]` modules are kept while the rest of the file is
     the base's;
   - runs the receipt's own test ids with its lane: each must **fail with an assertion failure** (a compile, collect or
     missing-module failure does not count), and none may pass or skip;
   - runs the same ids at the head: each must pass.
2. **The pre-existing-assertion diff (PASS_TO_PASS integrity).** The verifier lists every `expect`, `assert*`,
   `toThrow`, `should_panic`, skip, `.only` or early `return` removed or changed in a test file **that exists at the
   base**, and every changed fixture or mock those tests read. New test files are not listed: the replay covers them.
3. **Who clears.** Both auditors, in the round they audit the range, rule each listed change non-weakening or
   weakening on the replay output and the diff. A receipt clears when the replay passed and both rule non-weakening;
   the delegator writes the gate-exception row citing both rulings, with no user question. **The user rules** when
   either auditor reads a weakening, they disagree, or the replay fails or cannot run.
4. **Class g stays with the user.** When the code under test lives in the spec file itself (a guard test's checker, a
   Rust test in a production file), the replay cannot separate the two, and the exception goes to the user as today.
5. **Prevention (layer 2).** Every brief says: commit shared fixtures, support files and imports **before** recording a
   RED, and record one receipt per case; a test file another open receipt names is not edited without saying so in the
   handoff.
6. **Kept from ADR-0145:** `check-pending` on every lane; the verifier's blob-id comparison at landing; the Rust lane
   through the repo entry and the rustfmt guard (decisions 5, 8); decision 9's upstream offer. **Dropped:** the RED-time
   snapshot ref, the evidence packet digest and the evidence lock (decisions 1, 2's target, 6).
7. **Layer 3, the tool.** `red-receipt.mjs replay --id <ID> --base <sha>` performs decisions 1–2 and writes the result
   beside the receipt; the verifier runs it for every BROKEN receipt. A changed-lines mutation spot check is optional
   evidence, not a gate.

## Consequences

- **Gained.** Most BROKEN receipts stop reaching the user; the proof is the one the industry uses; nothing new to keep
  on disk; the test text that lands is the text that was proved.
- **Costs.**
  - A replay needs the head's tests to run against base production: a test that imports a module the branch created
    fails with a missing module, which decision 1 does not count, so that receipt goes to the user. Such receipts are
    the common case for brand-new modules; layer 2 reduces it only partly.
  - It proves "fails without this branch", not "failed at RED before this cycle's change": a multi-cycle item whose
    later case depends on an earlier cycle's code is replayed against the whole branch's absence, which is weaker per
    cycle.
  - The auditors' rulings add work to round one, and a weakening hidden in a new file's fixture is caught only by
    their reading of the test diff, as today.
  - Rust inline tests make the restore a per-file splice; until the tool does it, the verifier replays Rust receipts
    only when the test lives in its own file, and sends the rest to the user.
