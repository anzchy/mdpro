# 0124. Two implementation slots, and a herdr mixed-model roster overlays rule 70

## Status

Partially superseded 2026-10-22 by [ADR-0131](0131-every-audit-request-and-every-fix-round-starts-from-a-fresh-context.md): decision 3's clause "fable-auditor (a Fable session …)" (Fable is a fresh subagent per request again); decision 4 is extended with the per-request `/new` reset.

Accepted, 2026-10-20. Decided by the user, recorded by herdr-delegator. The user's words:
「Accept (Recommended)」, and on the Codex guard files 「AGENTS.md + .codex/rules (Recommended)」.

Proposed 2026-10-18. Revision 3, 2026-10-20. Revision 2 followed the first
ADR-0118 review (gpt-auditor C0 H3 M4 L1, Opus C0 H2 M6 L4), and both confirms found no blocking
finding (gpt-auditor C0 H0 M2 L1, Opus C0 H0 M1 L4). Revision 3 answers their remaining Medium and
Low points.

On acceptance, this ADR partially supersedes:
- [ADR-0119](0119-four-implementation-slots-machine-wide.md): "four machine-wide", everywhere, not
  only under herdr;
- [ADR-0115](0115-every-pre-landing-audit-runs-twice-codex-and-fable-on-the-same-dimensions.md),
  under herdr only: Fable as a subagent of the delegator, and each auditor posting its own
  round-one report on the PR (rule 70's "the way the Codex auditor posts its own");
- [ADR-0118](0118-three-implementation-slots-and-opus-reviews-adrs-and-plans.md) decision 2: the
  Codex review run by mdpro-codex-audit, under herdr only;
- [ADR-0121](0121-audit-effort-follows-risk-pre-existing-findings-do-not-block-and-auditors-are-measured.md):
  `/security-review` "run by mdpro-codex-audit", under herdr only.

Each of those gets a forward link in its Status line. Everything else in them stands.

## Context

On 2026-10-18 the user moved the delegator role into a herdr pane (herdr-delegator) and added two
Codex implementors under herdr, gpt-imple-1 and gpt-imple-2 (`gpt-6-sol`). Commit `af72940d`
threaded them into rule 70.

Rule 70 assumes all-Claude sessions:
- every peer is in `ListAgents` and talks by `SendMessage`;
- `role-guard.sh` polices implementors;
- the Codex auditor is a Claude session that dispatches Codex, and also runs Claude's
  `/security-review`.

A Codex agent has none of these. It turned out that it *can* record tdd-guardian receipts: the
receipt CLI is a plain Node script. An early draft of this ADR wrongly said otherwise, until the
review pointed it out.

The same day:
- **The cap.** The user cut it: 「decrease slot (parallel implementor to 2), those two are
  gpt-imple-1 and @mdpro-a6 auditor still goes to @mdpro-codex-audit」. For the items already over
  it: 「Finish, then cap (Recommended)」.
- **The reboot** ended every Claude peer session. The user: 「目前就剩gpt-imple-1, gpt-imple-2 和
  auditor(fable)，看看接下来v0.3.6 还有哪些任务，重新分配工作给这些implementor」. With a6 gone,
  the two slots went to gpt-imple-1 and gpt-imple-2 (「Chain + orphans (Recommended)」).
- **The Codex auditor:** 「Start a new herdr session with gpt-6.1-astra high effort( you need to
  check if this model is right), name the session `gpt-auditor`」. No `gpt-6.1-astra` is in the
  local Codex model list, so the user picked 「gpt-6-astra」.
- **Fable:** 「now we have auditor powered by Fable, all Fable work in this session subagent,
  should go directly to @fable-auditor」.
- **ADR and plan reviews:** 「ADR/plan reviews 交给 gpt-auditor」, keeping the Opus subagent as
  second reviewer (「gpt-auditor + Opus subagent (Recommended)」).
- **This rule:** 「看看是否要创建一个新rule，在herdr 中以当前的role为主(powered by mixed models)
  rule 70 适用于全Claude场景」, answered 「Rule 71 overlay (Recommended)」.
- **Briefs:** 「由于是cross model delegate tasks, 之后给implementor 布置任务，要详细交代任务背景，
  给出详细的验收标准，让 implementor执行完之后，自己验收合格再由你确认」.

## Options considered

1. **Keep editing rule 70 inline**, as `af72940d` started. Lost: rule 70 is 30 KB, and threading
   Codex exceptions through every paragraph mixes two setups.
2. **A full, self-contained herdr rule.** Lost: it repeats every gate, and two copies of the
   landing gate, the audit merge and the round cap drift apart.
3. **An overlay, rule 71 (chosen).** It names the rule 70 clauses it replaces, and rule 70
   governs the rest.

On the other questions:
- **Cap:** four lost, because the user named two.
- **ADR reviewer:** gpt-auditor alone lost, because it drops the two-model check. gpt-auditor with
  fable-auditor lost, because it reverses ADR-0118's 「Fable只参与审计pr，不参与adr等其他的」.
- **Receipts:** reported RED output in place of a receipt lost once the CLI was shown to run
  without Claude. It would have weakened rule 10 for no reason.

## Decision

1. **Cap.** One unlanded implementation item per session and **two** machine-wide, with or without
   herdr: the user named the number, not the setup. Rule 70's cap line says two on acceptance, and
   rule 71 only points to it. Items already over the cap finish first. ADR-0097's counting is
   unchanged.
2. **Rule 71 is in force whenever the delegator is herdr-delegator.** Rule 70 governs every
   clause rule 71 does not name, including landing, verdict merging, round caps, tiers, receipts,
   numbers, the Mac mini, and the device roles and batches. Rule 70 gains one pointer to rule 71.
3. **Roster.**
   - gpt-imple-* are the implementors.
   - gpt-auditor (Codex `gpt-6-astra`, high) is the Codex half of every PR audit and the Codex
     reviewer of ADRs and plans.
   - fable-auditor (a Fable session, under the `mdpro-fable-auditor` definition's blind clauses)
     is the Fable half of PR audits.
   - `/security-review` on the High tier is run by an Opus fork of the delegator, in the same
     turn as the audit requests. A run that fails keeps the gate closed.
   - The rule 70 device roles are inherited. When one is offline, its work waits.
4. **Codex agents.**
   - They get work through a brief file and `herdr agent prompt`, and report through files.
   - `AGENTS.md` and `.codex/rules/mdpro.rules` stand in for `role-guard.sh`. They are committed,
     and the delegator checks that each Codex worktree has them.
   - They record receipts with the Node CLI.
5. **Briefs and self-acceptance.** Every grant carries six sections: background, scope, numbered
   acceptance criteria with their proofs, out of scope, gates, and a self-acceptance table. The
   implementor proves each criterion before handing off, and the delegator checks the evidence
   before any audit starts.
6. **Blindness.** Neither auditor posts on the PR. Neither reads the other's reports or the PR's
   comments before its own round-one verdict. The delegator posts both, then the merged verdict.

## Consequences

- **The concurrency cap halves against ADR-0119.** The effect on throughput is not measured. The
  menu chain M3 → M1b → M4/M5/D255-WI-3 → M6 is mostly serial, so it likely loses less than half,
  but D287, D288 and ADR-0123 sit parked meanwhile.
- **gpt-auditor runs `gpt-6-astra`, not `gpt-6.1-sol`.** Its counts are not directly comparable
  with earlier Codex audits in `docs/audit/audit-log.md`. ADR-0121 requires replaying both
  auditors on every escape before an auditor's model changes. On 2026-10-20 `docs/audit/escapes.md`
  held no escapes, so the result is "insufficient evidence", and the user decided without numbers
  (「gpt-6-astra」, quoted in Context). The first escapes recorded after this change are replayed
  against both models.
- **Codex audits now run in a pane, not in a Claude session that dispatched Codex.** A restart
  loses the thread, so every challenge and confirm must name the earlier report file.
- **The Codex guard is prefix rules plus instructions, in uncommitted copies.** `git -C <dir>
  push`, or a worktree the delegator forgot to seed, slips past it. `role-guard.sh` would have
  caught the first case for a Claude implementor.
- **The guard files are committed with this ADR** (the user: 「AGENTS.md + .codex/rules
  (Recommended)」). A worktree created from `master` after that carries them. One created earlier
  shows a modified `AGENTS.md` until it rebases, and its implementor must never stage it.
- **Two rules must be read together.** The pointer at the top of rule 70 is the only bridge, and
  it is a thin one.
- **Briefs cost the delegator time on every grant.** The first two briefs each needed amending
  after the implementor found a conflict, which shows that a brief can be wrong as well as
  incomplete.
- **D286 landed before the gap in step 3 was noticed**, with Codex's own security section and no
  Claude `/security-review`. The skill was run afterwards (C0 H0, PR #510).
- Going back to all-Claude needs no new ADR: rule 71 simply stops applying, and the cap stays two.
