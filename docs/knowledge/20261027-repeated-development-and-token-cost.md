# Repeated development and token cost (2026-10-27)

herdr-delegator answered the user's question:
「看看当前project session，有没有就某个feature/issue反复进行开发，非常耗费token的地方，如果有，查一下具体原因是什么,
recommend best practices for solving them.」

Two subagents did the reading:
- an echo-sleuth recall over the session history:
  [`../reference/20261027-repeated-development-recall.md`](../reference/20261027-repeated-development-recall.md);
- a usage-field analysis of Claude transcripts and Codex sessions:
  [`../reference/20261027-token-cost-by-item.md`](../reference/20261027-token-cost-by-item.md).

Both note gaps:
- Claude transcripts from before 2026-10-22 live on the MacBook;
- Codex history starts on 10-16;
- item attribution is about ±30 %.

The unit is weighted tokens (W). It counts input, 1.25× cache writes for 5 minutes and 2× for 1 hour, 0.1× cache
reads, and 5× output, so W tracks cost.

## Yes: the repeated items

| Item | Cycles | Why it was redone |
|---|---|---|
| D261 → D319 | 4 implementations, 7 audit rounds, 4 device runs | Tests fed made-up AppKit notifications in an assumed order. The real order was seen only on the device, after landing. Fix 3 worked because it first logged each step of the menu capture. |
| D255 family + M1b | 31 auditor reports; device batches B5/B5b/B5c, B6/B6b | WI-3b's brief was amended 16 times in one day as new readers of the shortcut contract turned up. Rust failures appeared only on Linux CI. Receipts needed waivers. |
| D290, WI-4.3b, D305 | 3–5 audit rounds each | Each round found one more "something happens during an `await`" case. |
| D294 | 2 mitigation PRs, 4 device sessions | Its 1-in-16 crash could not be told apart on the device, so it shipped as a known issue. |
| D322 | 5 stops in one hour before audit | An AC outside the brief's paths; extra attack rounds; a test already red; a Medium-only review stopped the workflow anyway. |
| ADR-0141 WI-1 | many restarts | Node 24 vs 22, PATH, Codex start-up, Linux-only CI skips. |
| Receipt gate | 14 of 23 PRs waived | Whole-file line hashes; nothing stored to show what changed. |

The recurring causes:
1. platform behaviour first verified after landing;
2. races found one per audit round;
3. brief scope or a card not matching the change;
4. macOS-only gates;
5. gate false positives;
6. tool and environment instability;
7. rule churn (34 commits to rules 70/71 in 11 days);
8. High-tier process on small items.

## Where the tokens went

| Sink | Size | Why |
|---|---|---|
| GUI device sessions (dtrack / mac-test) | 178M W, 51 % of Claude spend | 1,759 `sleep` calls and 1,584 screenshots. 218 groups of identical calls, `screenshot {}` up to 79 times in one session. Access was requested per item. |
| The delegator at large context | 62 % of its W is from calls over 400k | Sessions ran 1.5–3 days at up to 964k context. A call over 600k costs about 3.5× one under 200k. The cache was rebuilt 34 times. |
| Wake-ups and polling | 54.5M W of wake-up turns; about 36M W of polls | Each poll re-reads a 360–960k context. |
| Rework | about 30–40 % of all spend | D305 94 %, D255 61 %, D319 59 %. |
| Always-on instructions | about 80M W re-read, plus 19.5M W in cold starts | CLAUDE.md, AGENTS.md and seven rules total 31–36k tokens; rules 70 and 71 alone are about 17k. |
| claude-mem observer (outside the question) | about 60M W equivalent | 300 headless sessions summarising mdpro. |

## What is being done

Already decided:
- **The causes behind rework.**
  - Items 1 and 3 above: [ADR-0144](../adr/0144-behaviour-acs-are-proved-in-the-real-app-before-landing.md), device ACs proved
    before landing against reviewed cards.
  - Item 2: [D323](../plans/20260912-frontend-backend-sequencing-order.md#d323), model and property tests for races.
  - Item 5: [ADR-0145](../adr/0145-a-broken-red-receipt-carries-its-own-evidence-and-the-auditors-rule-on-it.md), receipt evidence.
  - Item 4 has a standing waiver for its current case: [D325](../plans/20260912-frontend-backend-sequencing-order.md#d325)
    / G-D325-1.
  - All of these came from issue #542.

Adopted by the user on 2026-10-27 (all four options):
1. **Device runs wait on log lines.** No sleep-then-screenshot. Screenshots only as visual proof or on a failure.
   Computer Use access once per batch. This is in the device brief template.
2. **The delegator rotates at about 250k context.** It writes a handoff, then compacts or starts a new session.
   Subagents read long reports and return verdicts. This is in the mdpro-delegator guide.
3. **Slim always-on rules.** The detail of rules 70 and 71 moves into the mdpro-delegator skill and path-scoped
   files, leaving a short summary that loads every turn. Pending, because rule 71 and CLAUDE.md carry the user's
   uncommitted edits.
4. **Turn off the claude-mem observer for mdpro.** Done: `CLAUDE_MEM_EXCLUDED_PROJECTS` in `~/.claude-mem/settings.json`
   now lists the main checkout, `mdpro-wt/**` and `~/.mdpro-redesign/**` (the device tester's folder). The backup is
   `settings.json.bak-20261027`.

Not yet decided, and worth a user ruling:
- push the PR head and get Linux CI green before audit round one;
- a lighter pipeline for tooling and routine items;
- an environment preflight when each pane starts;
- freeze process changes during a release push.
