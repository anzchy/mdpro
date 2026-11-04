# 2026-11-04: A RED receipt is audit evidence, not a landing condition (A′)

## Current rule

- **Decided:** 2026-11-03, the user said 「你的建议采纳, go on」 and 「Fable A′ (Recommended)」; on 2026-11-04 the user said 「把 A′ 决定提交作为一个github issue，附上合适标签和link doc，然后再发给auditor审计，审计完排在最优先级实施」. This revision answers the two auditors' round-1 review of the frozen draft for [#628](https://github.com/anzchy/mdpro/issues/628).
- **Decision:** A RED receipt's verdict is audit evidence, not a landing condition; implementors continue per-cycle recording and verification. The entry and every current rule, agent, template, skill and ADR Status edit land in one High-tier policy commit.
  1. **Cutover.** This applies to verifiers dispatched after this commit is on master; before that, the existing gate applies and no exception cites this entry. GH592, GH607 and D354 wait for this commit, then are re-verified on their landing heads (user: 「等 A′ 落地」). The Claude landing verifier and Codex delegator both print `check-pending` as `info: FOCUSED-RECEIPTS`, outside PASS and without setting ISSUES; neither runs mandatory replay, prints REPLAYS, nor checks `--expect-digest`. A BROKEN, unsettled, weak or changed-spec verdict needs no automatic auditor ruling, gate exception or user word. `receipt-store.mjs keep-check` remains a PASS condition: it is an intentional byte-immutability and canonical-shape policy for parent evidence, including unreadable or non-canonical head files.
  2. **Evidence route.** The delegator puts `check-pending` flagged ids and the RED-pin → head diff of their spec files in the audit request's Known qualifications, as advisory evidence with no ruling or exception. If an auditor disputes whether a Critical or High regression test fails without the fix, the auditor asks; the delegator runs `replay` on that id or a base-tree test and the auditor cites the result in its finding. ADR-0161 d7's T-03 go-live proof still reads receipts to confirm that each cycle settled before the next. The replay tool, its digest and ADR-0149 d5's recording advice remain available.
  3. **Future CI check.** A separate rule-12 item (user, 2026-11-04: 「走 rule 12 (Recommended)」) will specify how bug-fix PRs and tests are selected, how branch-added code and Rust inline tests are handled, and whether the check is advisory or blocking; its spec defines selection, failure kind and blocking status. A base collect, compile or missing-module failure is inconclusive, never fail-to-pass proof. If it becomes a landing condition, it needs its own gate-sensitive entry and plan review. Until it lands, auditors apply rule 10's “fails without the fix?” question manually. No CI code changes in this item.
  4. **Earlier decisions.** ADR-0162 d1's “receipts are unchanged” is superseded by the later quoted user words. Its mid-release objection has expired because 0.3.6 shipped in PR #584; its d5–6 freeze ended then, and d2–4 are unaffected. A′ keeps the per-cycle recording and verification route accepted in ADR-0161, so it does not reverse that ADR. D347's 「Commit-per-cycle replay (Recommended)」 direction is closed by this decision; per-cycle RED recording remains.
- **Why:** In the 2026-10-30 RC1 census, 38 gate-exception rows included 25 receipt rulings; at base `8706fae6` on 2026-11-04 the register has 50 rows, 32 mentioning receipts (including mixed causes). The five recorded escapes credit no receipt, while the Findings table credits its Highs to auditors. D318-F1-2 was one real catch: it exposed an assertion removed from a new test after RED. Accepting that loss of an automatic landing stop costs an extra human reading of the advisory RED-pin diff; the new route keeps the signal visible to both auditors while reducing repeated rulings, replay runs and rebase digest work.
- **costs:**
  1. There is no landing-time machine proof of test-first order; auditors inspect regression tests, and the separate CI item may add fail-at-base proof after its own approval.
  2. A weakened spec after RED is advisory, even if the original receipt is BROKEN. The D318-F1-2 class can reach audit and needs a reviewer to catch it.
  3. Receipt tooling stays maintained although a verdict no longer gates landing; `keep-check` still gates byte and shape integrity.
  4. D357 is implemented and awaiting audit; its audit waits behind this top-priority policy item, then resumes under the new rule. The CI check is manual until the separate item lands.
- **changes:**
  - `.claude/agents/mdpro-landing-verifier.md`
  - `.claude/rules/10-tdd.md`
  - `.agents/skills/mdpro-delegator/SKILL.md`
  - `.agents/skills/mdpro-delegator/references/guide.md`
  - `.agents/skills/mdpro-delegator/references/landing-and-audit.md`
  - `.agents/skills/mdpro-delegator/references/roster-and-routing.md`
  - `.agents/skills/mdpro-delegator/references/templates/brief-template.md`
  - `.agents/skills/mdpro-delegator/references/templates/landing-docs-checklist.md`
  - `.agents/skills/mdpro-delegator/references/templates/audit-request-template.md`
  - `.agents/skills/mdpro-delegator/references/templates/merged-verdict-template.md`
  - `.codex/skills/mdpro-tdd-workflow/SKILL.md`
  - `.codex/skills/mdpro-tdd-workflow/references/review.md`
  - `.codex/agents/mdpro-tdd-reviewer.toml`
  - `docs/guide/receipt-evidence.md`
  - `docs/audit/audit-log.md`
  - `docs/agents/decisions/README.md`
  - `docs/agents/decisions/20261104-receipts-are-audit-evidence.md`
  - `docs/adr/0125-frontend-red-receipts-run-one-validated-test-file-not-the-full-coverage-lane.md`
  - `docs/adr/0129-a-high-that-survives-the-audit-cap-is-classified-tracked-and-expires.md`
  - `docs/adr/0145-a-broken-red-receipt-carries-its-own-evidence-and-the-auditors-rule-on-it.md`
  - `docs/adr/0149-a-broken-receipt-is-judged-by-a-base-tree-fail-to-pass-replay.md`
  - `docs/adr/0162-rework-countermeasures-before-0-3-6-and-a-process-freeze.md`
  - `tests/tooling/gh628-cutover.test.ts`
  - `tests/tooling/gh628-decision.test.ts`
  - `.claude/tdd-guardian/receipts/GH628-S1.json`
  - `.claude/tdd-guardian/receipts/GH628-S2.json`
  - `.claude/tdd-guardian/receipt-evidence/GH628-S1.json`
  - `.claude/tdd-guardian/receipt-evidence/GH628-S2.json`
- **supersedes:** ADR-0125 d5's unsettled-`unit-red` landing check (record/verify discipline remains); ADR-0129 d8's receipt-verdict exception class only (the general register remains); ADR-0145 d2, ADR-0145 d3, ADR-0145 d4, ADR-0145 d5 and ADR-0145 d6's mandatory replay, ruling, re-open and user paths, plus ADR-0145 d7's dependency on a decision-3 ruling and its Status-line receipt-exception path (per-RED evidence and locking remain); ADR-0149 d2, ADR-0149 d3, ADR-0149 d4, ADR-0149 d6 and ADR-0149 d7's mandatory replay, digest-bound clearing and user paths (the tool and d5 advice remain); ADR-0162 d1 (d5–6 expired with 0.3.6); and the sentence “The receipt verdict stays a landing condition” in `20261102-receipts-per-item-files.md` (storage and `keep-check` remain). The D347 direction quoted above is closed.
- **gate-sensitive:** yes: this changes a landing condition and the receipt contract (herdr-delegator, 2026-11-04; both auditors reviewed the frozen draft in round 1, this revision goes to their final review with the one policy commit).
