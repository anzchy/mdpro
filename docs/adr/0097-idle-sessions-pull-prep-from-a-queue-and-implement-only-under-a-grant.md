# 0097. Idle sessions pull prep from a queue and implement only under a grant

## Status

Accepted, 2026-10-15. Decided by the user. The user's question:
「现在我经常发现 a3、a6 以及 ADR 047 等 session 经常 idle。那么根据最佳实践，之后它们 idle 的时候，是否可以派遣其他一些任务，让它们开始做准备工作，或者直接进入 implement 的状态？」.
The user chose 「Let Codex weigh in」. After the Codex review the user chose 「Adopt revised (Recommended)」.

Partially superseded, 2026-10-17: the Cap's "two machine-wide", now three, by [ADR-0118](0118-three-implementation-slots-and-opus-reviews-adrs-and-plans.md).

## Context

Implementors (`mdpro-a3`, `mdpro-a6`) and the device harness (`adr047-verify`) waited for an
explicit assignment message from the delegator, and they were often idle. A handoff spends tens of
minutes waiting for PR CI and the Codex mini audit (ADR-0085, ADR-0095), and an area can be frozen:
on 2026-10-14 `mdpro-a6` was barred from CSS while `mdpro-a3` ran Plan P Stage 2. The user's
priority order at the time was to finish Plan P Stage 2, then Stage 3, with every other D item
deferred until Stage 2 landed.

Some forces work against simply handing out more work. The landing verifier, the single auditor
session and the machine-wide heavy lock (rule 10) are the bottlenecks. Every landing moves `master`,
and a rebase that changes `tests/` or `src/` defeats rule 70's re-run by tree identity. Rule 70 also
says a session must not act on old messages when the delegator is absent.

A Codex plan review (`gpt-6.1-sol`, effort high, thread `01a13b2b-a0a5-7d71-a909-f50655e8800d`)
returned NEEDS REVISION on the first draft. It found these gaps:
- "start, then notify" has no admission point;
- a cap on waiting handoffs hides dirty or committed unlanded branches;
- pre-implementing deferred work spends the capacity the priority work needs;
- the draft said nothing about what happens on restart or while the delegator is absent.

## Options considered

1. **Keep explicit assignment only.** Lost because it leaves sessions idle for the whole time a
   handoff waits on its gates.
2. **Queue with prep and implementation, start then notify, cap only waiting handoffs** (the first
   draft). Lost on the Codex findings: two sessions can claim the same area, unlanded inventory is
   uncapped, and deferred work competes with Stage 2.
3. **Prep-only queue.** Lost because it forces a round trip for implementation the delegator has
   already decided to allow.
4. **Codex's full revision**: a versioned queue whose entries carry seven fields, and a measured
   pilot. Lost on cost: that is more machinery than three implementors need. Its controls are
   kept and its bookkeeping dropped.

## Decision

The delegator keeps a short queue per session in its assignment messages and in its own handoff.
Each item is tagged `prep` or `impl`.
- **Prep is the default and needs no grant**: reading, read-only investigation, scratch documents
  outside the repo. Tracked edits, heavy commands, numbered artifacts and device runs keep their
  existing controls.
- **Implementation needs a grant** in the queue entry that reserves its file scope when the queue is
  issued. The session sends one line when it starts. Touching a path outside the grant needs a
  revised grant.
- **Deferred items stay prep** until the user's priority order makes them current.
- **Cap**: one unlanded implementation item per session and two machine-wide. Dirty, committed,
  waiting and fix work all count. The auditor's audits do not count.
- **Precedence**: audit fixes on the session's own work, then the current priority item, then a pull.
- **Landing order**: unchanged (rule 70). Among eligible items the user's priority decides; arrival
  order decides only among equals.
- **No new pulls** while `mdpro-delegator` is absent from `ListAgents` or restarting. Claims are
  reconciled from the delegator's handoff first.
- The policy is reviewed after a week of use.

## Consequences

- Idle time goes into prep: root causes, test matrices, briefs. That shortens the next item's
  implementation without moving `master`.
- **Cost**: the delegator now keeps the queues and claims current, which adds bookkeeping to every
  assignment. A stale queue entry is a risk the delegator carries.
- **Cost**: the cap of two leaves cores idle even when more independent work exists. It was chosen
  as a conservative start, not measured.
- **Foreclosed**: implementing deferred work early "to land later". Priority work loses lock time
  and audit turnaround to it, and the rebases it causes cost more than it saves.
- Shared files (the sequencing doc, `receipts.json`, the ledger) stay shared: each session edits only
  its own rows and keeps unique receipt ids, as rule 70 already requires.
