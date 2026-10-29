# 0149. A broken receipt is replayed against the PR base, with the RED-time test text kept for the auditors

## Status

**Proposed, 2026-10-29, by herdr-delegator (Claude route). Revision 2, after plan review round 1** (gpt-auditor
C0 H5 M2, opus-auditor C0 H5 M7 L3; reports `herdr-spike/{gpt-auditor,opus-auditor}/ADR-0149-r1.md`). Round 1 found that
revision 1 let a weakening inside a new test file clear unseen, could not be run on today's receipts (they store no
failing test ids), left the auditors' rulings bound to no bytes, and contradicted ADR-0145 in clauses it did not name.
Revision 2 keeps ADR-0145 almost whole and changes two of its clauses.

The user's words: 「针对上述问题，你的解决方案是什么，web search 查看最佳实践」; 「All three layers (Recommended)」;
「相关的解决方案尽快implement，优先级排最前面」; and, on round 1's finding about the interim,
「Evidence + batched ruling (Recommended)」 (2026-10-29), which replaces revision 1's "layer 1 clears without the user".

**On acceptance, partially supersedes** [ADR-0145](0145-a-broken-red-receipt-carries-its-own-evidence-and-the-auditors-rule-on-it.md):
- decision 1's **snapshot of the code under test** (a commit object under `refs/receipts/<id>/<recorded-at>`), replaced by
  decision 1 below (only the spec files are kept);
- decision 2's **re-RED target** (the snapshot's non-test paths), replaced by the PR base (decision 2 below).

Every other ADR-0145 clause stands as written, including its Status line's "until the entry … ships, receipt exceptions
keep the existing user path", which decision 6 below makes concrete.

## Context

- The tdd-guardian receipt fingerprints every non-blank line of the spec files at RED; any edited or deleted line at the
  first green settles SEPARATION-BROKEN, terminally (`verification.js:734`, `:774`).
- Census (2026-10-27, `docs/reference/20261027-receipt-separation-broken-causes.md`): 67 of 710 receipts BROKEN; of the
  38 that exceptions name, one real weakening (D318-F1-2, an assertion removed from a **new** test). Seventeen exception
  groups went to the user; five more receipts broke on 2026-10-28.
- ADR-0145 (Accepted 2026-10-27) answers it with evidence at RED, a re-RED, auditor rulings bound by a content-addressed
  packet, and auditor clearing; nothing of it is built. Its re-RED target is a commit snapshot of the whole code under test
  at RED, kept under a local ref per receipt.
- **Practice elsewhere** (web search, 2026-10-29): SWE-bench grades a fix by FAIL_TO_PASS (the final tests fail before
  the fix and pass after) and PASS_TO_PASS ([OpenAI](https://openai.com/index/introducing-swe-bench-verified/)); the
  .NET MAUI check reverts the fix files to the base branch and requires the tests to fail
  ([skill](https://tessl.io/registry/skills/github/dotnet/maui/verify-tests-fail-without-fix)). Both use the base, which
  git already holds, rather than a stored snapshot.
- **Round 1's findings** that shape this revision: the final test text alone cannot show a weakening made after RED
  inside a new file, because base has no such file; today's receipts hold only 16-hex line hashes and a whole-file sha
  (`verification.js:331-342`) and no failing ids (`red-receipt.mjs:120-129`), so neither can be recovered; and rulings must
  be bound to the bytes they read, which ADR-0145 decisions 3–4 already do.

## Options considered

1. **Revision 1** (base replay, a base-existing-files diff, auditors clear, applying at once). Lost in review: the
   weakening class it was built for passes unseen, and it could not run on today's receipts.
2. **ADR-0145 as accepted.** Kept almost whole. Lost only in its whole-tree snapshot: the PR base gives the same
   fail-without-the-change proof for the recorded ids without storing production code per receipt.
3. **ADR-0145 with the spec text kept at RED and the replay pointed at the base.** Chosen.

## Decision

1. **Evidence at RED (replaces ADR-0145 decision 1's snapshot; the rest of decision 1 stands).** The repo entry
   (`scripts/tdd/red-receipt.mjs`, both lanes) records, beside the plugin's receipt and under ADR-0145 decision 6's lock and
   sidecar:
   - the **failing test ids** with their failure kind (assertion, panic, compile or collect error), as ADR-0145 decision 1
     already says;
   - the **spec files' text at RED**: each spec file's blob written with `git hash-object -w` and pinned by the local ref
     `refs/receipts/<id>/<recorded-at>/spec` (a tree of those blobs), never pushed, deleted 30 days after landing;
   - the plugin version, the lane command and its environment.
2. **The replay (replaces ADR-0145 decision 2's target; its print step and fail-closed cases stand).** For a receipt that
   ADR-0145 decision 2 or 5 sends to evidence:
   - **print** the RED → head diff of every spec file from the pinned blobs, plus the base → head diff of the whole
     `tests/` tree, so changed support, fixtures and **new** files are in the evidence;
   - **replay** in a detached worktree at the head with every non-test path restored to the PR base
     (`git merge-base`; `tests/` and Rust `#[cfg(test)]` modules kept at the head, as ADR-0145 decision 2 defines test
     paths): each recorded failing id must **fail with an assertion failure**, none may pass, skip or disappear; then each
     must pass at the head. It fails closed in ADR-0145 decision 2's three cases.
   - Output goes to the sidecar evidence file. **The verdict stays BROKEN.**
3. **Rulings, clearing, class g, holes, upstream: ADR-0145 decisions 3, 4, 5, 7, 8 and 9 stand unchanged.** The packet
   digest now covers the pinned spec tree id in place of the snapshot commit id. Auditors rule non-weakening or weakening
   on the printed diffs using ADR-0145 decision 3's oracle-change list; a ruling cites the digest; the delegator checks
   the digest against the landing head under the evidence lock, and any mismatch (a fix round, a rebase, a later commit)
   re-runs the replay and returns the receipt to both auditors.
4. **Receipts recorded before decision 1 ships** have no failing ids and no RED-time text. They take the replay only as
   far as it can run (the spec files' tests at base: list every case that passes there) and never clear without the user
   (decision 6).
5. **Prevention, in every brief from 2026-10-29:** commit shared fixtures, support files and imports **before** recording a
   RED; record one receipt per case; a test file another open receipt names is not edited without saying so in the
   handoff.
6. **Until the entry ships (ADR-0145 Status), the user still rules, once per landing.** The verifier runs decision 2 as far
   as today's data allows (decision 4), both auditors rule on the printed diffs in their round, and the delegator asks the
   user **one** question per landing listing every BROKEN receipt with its evidence and both rulings, instead of one
   question per receipt. After the entry ships, ADR-0145 decision 4 applies: both auditors' non-weakening rulings on a
   passed replay clear it, and the user is asked only about a weakening, a disagreement, or a replay that failed or could
   not run.
7. **The entry is built as one item, first in the queue** (user: 「相关的解决方案尽快implement，优先级排最前面」): ADR-0145
   decisions 1 (as amended here), 2 (as amended), 5, 6 and 8, with `red-receipt.mjs replay --id <ID>` producing decision
   2's evidence file, and the landing verifier's step 4 amended to run it for every BROKEN receipt and check the digest.

## Consequences

- **Gained.** A weakening made after RED, in a new or an old file, is printed for both auditors; most BROKEN receipts
  stop reaching the user once the entry ships; until then the user answers one question per landing, not one per receipt.
  Nothing per receipt is stored but its spec files' text.
- **Costs.**
  - Replaying against the base proves each recorded id fails without **this branch's** production change, not without
    **the cycle's** change. In a multi-cycle item, an id whose RED depended on an earlier cycle's code may still fail on
    base for that earlier reason. The auditors read the RED → head diff to judge it.
  - A test that imports a module the branch created fails on base with a collect or missing-module error, which does not
    count, so such receipts go to the user. Decision 5 reduces this only partly.
  - Rust inline tests make the restore a per-file splice, which the entry must implement.
  - Pinned spec blobs live 30 days after landing, in every worktree's shared object store.
  - Until the entry ships, the user still rules on every BROKEN receipt, though in one batch per landing.
