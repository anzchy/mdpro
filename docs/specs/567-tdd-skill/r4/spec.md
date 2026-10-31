## Parent

#567

## Problem Statement

mdpro's TDD method for implementors no longer has one home. Since #564 the tdd-guardian plugin has been off for Claude. Its two valuable parts, the independent **matrix attack** and **RED receipts**, are now owned by mdpro, but the method is spread across rule 10, rule 12, rule 71 § Briefs (with separate Claude and Codex variants), the brief template, `prompt.sh`'s brief text and a standalone attack prompt. Codex still runs the plugin, so the two runtimes follow different procedures for the same brief.

For the delegator and the user, this means:
- every brief has to spell out the method again;
- a rule change has to be made in several places, and a missed one leaves the runtimes disagreeing (fable-auditor's Medium on #564: ADR-0148 decision 7 and ADR-0138's adversary row still name the plugin for Claude);
- nothing checks that the installed Matt Pocock skills are recent enough for the method that relies on them;
- a third-party plugin still orchestrates Codex's TDD stages, although mdpro now owns everything the plugin did that mattered.

The research reviews of 2026-10-31 (`docs/reference/20261031-slicing-best-practice-{codex,fable}-review.md`) also showed that rule 71 step 4's "all REDs first" for non-gated items is against primary-source TDD practice (Beck's Canon TDD).

## Solution

One project skill, **`jack-tdd-workflow`**, holds the method an implementor follows from the **test matrix** to the handoff's self-acceptance table, on both runtimes. The rules keep the law (what must be true, who decides, the gates); the skill holds the method (how to do it). Briefs and `prompt.sh` name the skill instead of restating the method.

The method is vertical at the implementation level: the matrix is written up front as a list of cases, a fresh subagent attacks it, and then each **cycle** takes one case through its RED receipt, the minimal change, `verify`, and a small refactor with tests green.

Once the skill is live (the landing that points both runtimes' briefs and `prompt.sh` at it), Codex stops using tdd-guardian as well. Both runtimes then follow the same skill, and mdpro no longer routes any work through the plugin (user, 2026-10-31: 「codex 的tdd-guardian 在jack-tdd-workflow 上线之后就retire」).

## User Stories

1. As the delegator, I want a single skill name to cite in every implementor brief, so that a brief states what to build and not how to do TDD.
2. As the delegator, I want the Claude and Codex implementors to follow the same method text, so that one brief works on either runtime.
3. As the user, I want the TDD method in one place, so that a change to the method is one edit and cannot leave the runtimes disagreeing.
4. As an implementor, I want the skill to tell me what a test matrix must contain (success, boundary, invalid input, lifecycle and timing, every caller path, platform), so that I don't miss the case classes that caused earlier Highs.
5. As an implementor, I want a matrix template, so that every matrix has the same shape and the delegator can check it quickly.
6. As an implementor, I want each matrix case to name its assertion (a document, state or IPC effect, never a bare boolean) and its test file, so that the attacker and auditors can judge it.
7. As an implementor, I want the skill to tell me how to get my matrix attacked by a fresh subagent, so that the attack is independent of my own context.
8. As an implementor, I want the attacker to be a fresh subagent, never a fork or a resumed agent (an Opus subagent at default effort on Claude, a fresh Codex agent at its default model and effort, started as a new `codex exec` process with no resumed session and given only the attack prompt, the brief and the matrix on Codex), so that it shares none of my context and both runtimes attack the same way.
9. As an implementor, I want the attack to run once per grant, with at most one re-attack after I add cases, so that the attack cost is bounded.
10. As an implementor, I want each gap the attacker reports to be either added as a case or rejected with a counter-proof (an existing case that catches it, or the brief's Out of scope), so that the matrix doesn't fill up with impossible cases.
11. As an implementor, I want a gap the attacker marks NEEDS RULING, or one still open after the re-attack, to stop me and go to the delegator, so that I never decide scope myself.
12. As an implementor, I want to write `ATTACK-NOT-RUN` and stop when the attacker cannot run, so that a missing attack is visible rather than skipped.
13. As an implementor, I want the attacker's findings copied verbatim into the attack file, so that the delegator can see exactly what was reported.
14. As an implementor, I want to build each item in cycles (one case, its RED receipt `<ID>-S<n>`, the minimal change, `verify`, then a small refactor with tests green), so that each green step informs the next test and a refactor can never break a receipt.
15. As an implementor, I want permission to write and record the item's acceptance check (a single exit-condition test, such as a bug's reproduction or an end-to-end check) RED as `<ID>-ACC` before the first cycle, verified when the last cycle settles, because it is the exit condition and not the design.
16. As an implementor, I want the skill to say plainly that a cycle has one intended assertion and records one `--test` file, and that unit REDs are never recorded as a batch, so that I don't fall back to "all REDs first".
17. As an implementor, I want a one-test fix round to count as one cycle, so that small fixes don't need the full matrix ritual.
18. As an implementor, I want a refactor too big for one cycle to stop and go to the delegator as a separate prefactor item, so that the item's diff stays reviewable.
19. As an implementor, I want to check that a test compiles and runs to its assertion before I record its RED, so that a build or harness error is never recorded as a RED.
20. As an implementor, I want the skill to give the exact receipt commands (frontend and Rust, with the heavy-lock guard and the `cargo fmt` precondition) by pointing at rule 10, so that the commands live in one place.
21. As an implementor, I want a test that is green before any change to be recorded as raw-green and named in the handoff, so that a test that cannot fail is visible.
22. As an implementor, I want to amend the matrix mid-item, marking a new case inside an existing seam and AC "added in cycle n" without a new attack, so that cases found while working are captured.
23. As an implementor, I want a new seam, a changed behaviour, or a case that changes what an AC means or covers to stop me for the delegator, who decides whether a re-attack runs, so that scope changes are ruled on, not slipped in.
24. As an implementor, I want the route for correcting a recorded test line (back out the production hunk by edit, correct the line, record a new suffixed RED, re-apply, verify, keep the old receipt untouched), so that a mistaken RED is fixed without faking history or running a rule-25 command.
25. As an implementor, I want the skill to tell me to run `/code-review` on the committed candidate with tests green before the handoff, so that review happens before the auditors see it.
26. As an implementor fixing a D item, I want the skill to point me at `/diagnosing-bugs` to get a tight feedback loop before the first RED, so that I fix the cause, not a symptom.
27. As an implementor, I want the skill to end with the handoff's `AC | evidence | verdict` table, followed by the lanes, tree SHAs and paths changed, so that my self-acceptance has the shape the delegator checks.
28. As an implementor, I want the handoff to name every approach I rejected and why, so that a fresh fix session knows what was tried.
29. As an implementor, I want the skill to use the GLOSSARY terms (Test matrix, Matrix attack, RED receipt, Cycle), so that my handoff means the same thing to every reader.
30. As the delegator, I want the GLOSSARY to define those four terms with an _Avoid_ list, so that briefs, rules and handoffs stop drifting between synonyms.
31. As the delegator, I want `prompt.sh` to refuse to send a brief when the target runtime's installed Matt Pocock skills are missing, older than 1.3.1 or malformed, and a macOS-only tooling case to check both real caches, so that the method never relies on a skill version that lacks what it needs.
32. As the delegator, I want that version check to run on fixture plugin caches in CI, because CI has no real plugin cache.
33. As the delegator, I want a tooling test that fails if the skill, its `.claude/skills` link, its matrix template or its attack prompt goes missing, or if the Claude route names the tdd-guardian plugin, so that the skill can't be broken silently.
34. As the delegator, I want `prompt.sh` to name `jack-tdd-workflow` in the brief text for both runtimes, so that the prompt and the brief agree.
35. As the delegator, I want the brief template to name the skill and keep only what is item-specific (ACs, scope, lanes), so that briefs are shorter.
36. As the user, I want rule 71 § Briefs and rule 12's implementation section reduced to the law, pointing at the skill for the method, so that the rules stay readable.
37. As the user, I want rule 10's receipt commands kept in rule 10, so that the commands that touch receipts stay in an always-on rule.
38. As the user, I want dated guides and historical handoffs left untouched, so that records of past work keep saying what was true then.
39. As the user, I want a new ADR that partially supersedes ADR-0148 decision 7's named clauses, ADR-0138's adversary row and stop rule, and ADR-0139 decision 3, and retires tdd-guardian for Codex, so that the accepted ADRs are not edited and the change has a record of its costs.
40. As the user, I want Codex to stop using tdd-guardian as soon as the skill is live, so that both runtimes run one method from that landing on.
41. As a Codex implementor, I want to run the skill's stages with Codex's installed Matt Pocock plugin (1.3.2) and the same attack prompt, so that I need no tdd-guardian plugin.
42. As a Codex implementor, I want AGENTS.md's table of Claude-only features to point at the skill instead of `$tdd-guardian:tdd-guardian-workflow`, so that my session start reads the right method.
43. As the delegator, I want the first gated Claude item granted after both 0.3.6 and go-live to run the skill end to end (I hold that grant until both are true), and I want to confirm its real RED, fresh-dispatch attack file, HELD verify and cycle ordering, so that the skill is proved on real work.
44. As the delegator, I want the first Codex item after go-live that runs a full matrix checked the same way, so that a Codex-side gap shows up on the first item rather than later.
45. As the user, I want the ADR accepted before that first real run, so that the run tests a decided method.
46. As the user, I want #566 (vendoring and pinning the receipt engine) to land before any #567 ticket, so that retiring the plugin for Codex doesn't leave receipts loading code from its cache.
47. As a reader of the skill, I want it to cite its primary sources (Beck's Canon TDD, Google's Small CLs, Parallel Change) and Matt Pocock's `tdd`, `code-review` and `diagnosing-bugs` skills, so that the method's reasoning can be checked.
48. As the user, I want the skill to stay within an agent's context budget, so that it doesn't crowd out the brief (OpenAI's note that a skill read takes up context).

## Implementation Decisions

- **The skill.** A new project skill `jack-tdd-workflow`. The canonical directory is under `.agents/skills/`; the `.claude/skills` entry is a symlink to it, as for `mdpro-delegator` and `remote-windows-device-test`. It has a `SKILL.md` and reference attachments: a matrix template (T-01), and the attack prompt, moved from the delegator skill's templates at go-live (T-02), when the old path is removed and every reference is updated.
- **Scope of the skill.** From the test matrix to the handoff's self-acceptance table. Planning (`/grill-with-docs`, `/to-spec`, `/to-tickets`), audits, landing and device batches stay outside. D items use `/diagnosing-bugs` before the first RED.
- **Method, in order.**
  1. Design the matrix to the case list in User Stories 4–6, recorded in the item's matrix file.
  2. Have a fresh subagent attack it, once per grant with at most one re-attack, and copy its findings verbatim into the attack file. On Claude the attacker is a fresh Opus subagent at default effort; on Codex a fresh Codex agent at its default model and effort, started as a new `codex exec` process with no resumed session and given only the attack prompt, the brief and the matrix. No routing by difficulty.
  3. Amend the matrix: add each gap as a case, or reject it with a counter-proof. Stop for the delegator on NEEDS RULING or a gap still open after the re-attack.
  4. Optionally, write and record the acceptance check first, as `<ID>-ACC`.
  5. Run cycles, one matrix case each: test (one intended assertion, one `--test` file), a check that it runs to its assertion, a RED receipt `<ID>-S<n>`, the minimal change, `verify`, then a small refactor with tests green. Each cycle settles before the next starts.
  6. Run `/code-review` on the committed candidate.
  7. Write the handoff with the self-acceptance table.
- **This replaces rule 71 step 4's "all REDs first" for every implementor item, gated or not** (grill Q15′). A one-test fix round is one cycle. Unit REDs are never batched.
- **Matrix amendment** (grill Q16, refined by 「Split by kind (Recommended)」): a new case inside an existing seam and AC is marked "added in cycle n" and needs no re-attack. A new seam, a changed behaviour, or a case that changes an AC's meaning or scope stops for the delegator, who decides whether a re-attack runs (at most one per grant).
- **Receipts.** The skill points at rule 10 for the exact `node scripts/tdd/red-receipt.mjs` commands and does not copy them. The recorded-line correction route (User Story 24) and raw-green naming are in the skill.
- **Matt Pocock skills.** Not vendored. Each runtime uses its own installed plugin: Claude has `mattpocock-skills` 1.3.1, Codex 1.3.2. The minimum supported version is 1.3.1. A pure version function decides whether a given plugin cache folder meets the minimum. `prompt.sh` runs it on the target runtime's installed cache before sending a brief and fails closed; a macOS-only tooling case runs it on both real caches; CI runs it on fixtures. Each brief keeps its skill-version pin.
- **Rules after the change.**
  - Rule 10 keeps its receipt commands.
  - Rule 12's implementation section and rule 71 § Briefs steps 1–4 keep the law (the matrix is attacked before any RED, who rules on gaps, the handoff table) and point at the skill for the method. The Claude and Codex variants collapse into one.
  - The brief template and `prompt.sh` name the skill for both runtimes.
  - AGENTS.md's feature table points Codex at the skill.
  - Dated guides and historical handoffs are left as they are.
- **Codex retirement of tdd-guardian.** It happens at go-live, the landing that points both runtimes' briefs and `prompt.sh` at the skill. This replaces the earlier grill decision (Q13) to switch Codex only after one validated cycle. From go-live on, no mdpro rule, brief, prompt or skill routes Codex to `$tdd-guardian:tdd-guardian-workflow`. The old `.codex/skills/mdpro-tdd-workflow/` port stays only as a record of historical handoffs. Disabling the plugin in the shared Codex install (`~/.codex/config.toml`) is the user's own step, outside the repo.
- **ADR.** A new ADR, numbered by the registrar:
  - ADR-0161 (Proposed, committed with the snapshot) partially supersedes ADR-0148 decision 7's "Matrix and attack first", "Step 4 becomes `tdd` cycles", "Review" and "Runtimes" clauses and the Status line's gated-only scoping; ADR-0138's `mdpro-spec-adversary` row and decision 5's stop-rule sentence; and ADR-0139 decision 3, for both runtimes. It records tdd-guardian's retirement for Codex.
  - It lists the options weighed: keep the rules only; vendor Matt's skills; keep the plugin for Codex until a validated cycle; retire it at go-live.
  - It records the costs, among them: Codex loses the plugin's coverage and mutation stages, which become the lanes and CI; and a method in a skill can drift from the rules it serves.
- **GLOSSARY.** The "TDD" section (Test matrix, Matrix attack, RED receipt, Cycle) is committed with the snapshot; r2 corrects Cycle's order to "the minimal change, verify, then a small refactor with tests green".
- **The attacker after go-live.** One procedure for both runtimes (user, 「Same as Claude」): a fresh subagent given the skill's attack prompt, with no routing by difficulty. Rule 71's `mdpro-spec-adversary` Models row stops routing, and the two `.codex/agents/mdpro-spec-adversary*.toml` agents are removed (T-02).
- **Other active tdd-guardian mentions.** Rule 70's "the tdd-guardian lanes are the author's job" and rule 10's `slow` lane wording become plain lane names. Receipt storage under `.claude/tdd-guardian/`, dated records, rule 71's 2026-10-20 history paragraph and the archived Codex port stay, as an explicit allowlist in the contract test.
- **Dependency.** #566 lands before any ticket of this spec.

## Testing Decisions

- **A good test here checks the contract other sessions rely on, not the wording.** Tests assert that a file or link exists and resolves, that a named command, path or skill name is present, that a forbidden reference is absent, and how the version function behaves. They don't snapshot prose.
- **Seam 1 (new): a skill-contract test** in `tests/tooling/`, in the node environment. It checks:
  - the skill directory and its `.claude/skills` symlink resolve;
  - `SKILL.md`'s frontmatter is valid and names the skill;
  - the skill names the rule 10 receipt CLI and its matrix template (T-01), and its attack prompt (T-02), and the attachments exist;
  - the skill states the cycle order, one case and one `--test` file per record, the `<ID>-ACC` / `<ID>-S<n>` id forms and the split amendment rule;
  - `SKILL.md` stays within a size cap (story 48);
  - after go-live, the attack prompt's old path no longer exists and nothing outside the allowlist references it;
  - after go-live, no active rule, brief template, `prompt.sh`, AGENTS.md, `.codex/` file or the skill routes either runtime to tdd-guardian or `mdpro-spec-adversary`, except the allowlist;
  - after go-live, the brief template, rule 71 and AGENTS.md point at the skill;
  - the pure version function accepts 1.3.1 and 1.3.2 fixture caches, and rejects 1.3.0, a missing cache and a malformed version;
  - one macOS-only case runs the function on the real Claude and Codex cache roots, declared in `tests/ci-inventory.json`.

  Prior art: `adr0141-wi2-skill-text.test.ts`.
- **Seam 2 (existing): `prompt.sh`'s runtime-routed brief text** in `mdpro-delegator-listener.test.ts`, extended (T-02) so that both runtimes' text names `jack-tdd-workflow` and neither names the plugin, and so that `prompt.sh` refuses to send a brief when the target runtime's fixture cache is missing, below 1.3.1 or malformed. T-01 leaves this test unmodified. Prior art: #564's macOS-only routing case, which is declared in `tests/ci-inventory.json`. Any new macOS-only case needs the same declaration.
- **Real-world proof (a process check by the delegator, not a `unit` or `device` AC under ADR-0144; ticket T-03, with its own brief and PR like every ticket):**
  - the first gated Claude item granted after both 0.3.6 and go-live (the delegator holds that grant until both are true) runs the skill end to end;
  - the first Codex item after go-live that runs a full matrix is checked the same way.

  For each, an audit-log row, carried by T-03's PR (audited at Low tier, landed by `--ff-only`), names the item and grant time, T-02's landing SHA, the attacker with fresh-dispatch evidence and the attack file, the first cycle's receipt and decisive assertion failure, the HELD `verify`, and the cycle ordering from `receipts.json` and the evidence sidecar (`S<n+1>` recorded after `S<n>`'s verify settled; `ACC` before `S1`). The ADR is accepted before the first of these runs.
- Every RED for these tickets is recorded with the rule 10 CLI under a `T567-` prefixed id.

## Out of Scope

- Ticket-level slicing (how `/to-tickets` cuts work). It stays with the planning skills. The research reviews are recorded in `docs/reference/` for later use.
- Planning, audits, landing, device batches and the brief's non-TDD sections.
- Vendoring Matt Pocock's skills, or editing them.
- #566's work itself (vendoring and pinning the receipt engine). It is a blocker, not part of this spec.
- Uninstalling or purging the tdd-guardian plugin cache, and any edit to `~/.codex/config.toml` or the shared Codex install.
- Rewriting dated guides, historical handoffs, accepted ADR bodies, or the archived `.codex/skills/mdpro-tdd-workflow/` port.
- `/implement` and `/implement-spec`, which stay forbidden under rule 12.

## Further Notes

- The grill rounds, with the user's answers quoted, are in the planner folder's `grill-log.md`: round 1 「是」; round 2 「Q9 用`jack-tdd-workflow` 作为name，其他的同意」; round 3 「Q5 Matt的Skill有codex版本,已经安装了，check一下.其他问题是」; round 4 「上面问题回答：是」; round 5 「Q15-Q16 agree」. Test seams: 「Yes, these seams (Recommended)」.
- After the grill: 「codex 的tdd-guardian 在jack-tdd-workflow 上线之后就retire」. This replaces Q13. The Codex retirement is part of the go-live ticket (T-02); T-03 is the proof on real work, with its own brief and PR.
- The ADR also closes fable-auditor's carried Medium from #564, the stale plugin references in ADR-0148 decision 7 and ADR-0138.
- Primary sources for the method: `docs/reference/20261031-slicing-best-practice-codex-review.md` and `-fable-review.md`.
