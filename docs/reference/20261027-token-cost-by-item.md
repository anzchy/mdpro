# mdpro token cost by work item and activity

Read-only analysis. Generated 2026-10-27. Scripts and pickles are in this scratchpad folder (`analyze.py`, `claude_items.py`, `codex.py`, `codex_items.py`, `overhead.py`, `poll.py`).

## Sources and units

| Source | Sessions | Period | Raw tokens | Weighted (W) |
|---|---|---|---|---|
| Claude, main checkout (delegator and others) | 7 main + 62 subagents | 10-04..10-26 | 966M | 134.0M |
| Claude, `dtrack` / `mac-test` device tester | 75 (+1 probe) | 10-07..10-24 | 1,230M | 178.4M |
| Claude, `mdpro-wt/opus-auditor` | 39 | 10-23..10-27 | 102M | 23.3M |
| Claude, `mdpro-wt/gpt-imple-1/2` (opus-imple-1 etc.) | 4 + 12 subagents | 10-25..10-27 | 81M | 14.2M |
| **Claude total** | 127 top-level + 74 subagents | | **2,378M** (98% cache reads) | **350.0M** |
| Codex rollouts (`~/.codex/sessions`, cwd under mdpro) | 252 (36 are Codex subagents) | 10-16..10-27 | 1,810M input (98.9% cached) + 4.0M out | 234.7M |
| claude-mem observer (Haiku), sessions that mention mdpro | 300 | 10-04..10-25 | 85.6M cache-write, 882M cache-read, 7.4M out | 297M in Haiku units |

**W (weighted tokens)** = input + 1.25 × 5-minute cache write + 2 × 1-hour cache write + 0.1 × cache read + 5 × output. These are Anthropic's relative price ratios, so W is proportional to cost on one model. Raw totals are dominated by cache reads and say little about cost; every ranking below uses W.

The Codex W uses the same ratios. GPT pricing differs, so treat Codex W as comparable in shape only. The Haiku observer's W is in Haiku units; at roughly 1/5 of Opus pricing it is about 60M Opus-equivalent (a guess).

**Coverage gap.** This machine holds only 8 main-checkout Claude sessions. Sessions run on the MacBook before ADR-0134 (2026-10-22) are not here, and nothing from 10-08 to 10-21 in the main checkout survived except as dtrack. Codex rollouts start on 10-16. So the item totals for older work (D1xx–D24x, the 0.3.x gates) are undercounts.

## 1. Top items

### Method
- **Claude.** Each API call is attributed to the item ids (`D\d+`, `ADR-NNNN`, `WI-…`, `B\d+x`, `M\d[a-z]`, `PR #`) named in its own tool inputs. If the call names none, it inherits the ids most recently named in that session ("sticky" attribution). Reads of CLAUDE.md, rules, skills and handoffs don't set the item, and a user prompt naming more than 4 ids doesn't either. A call that names k ids gives each 1/k of its W.
- **Codex.** A rollout is attributed by the ids in its first delegator prompt, which always names a brief or request file. A Codex subagent (spec-adversary) inherits its parent thread's ids.
- **Error.** I'd put the per-item error at about ±30%. 13.7% of Claude W (48M) stayed unattributed: delegator chatter, setup, and the early dtrack runs with no id in the brief. Batch names (B1, B2, …) were reused across two series (the 10-09 series and the 0.3.6 B1–B11 series), so B-row totals mix both.

### Top 10 by total W (Claude + Codex)

| # | Item | Claude W | Codex W | Total W | Claude sessions | Codex sessions | Rework share (Claude / Codex) | Dates |
|---|---|---|---|---|---|---|---|---|
| 1 | M1b | 8.8M | 45.7M | **54.5M** | 2 | 22 | 61% / 20% | 10-22..10-26 |
| 2 | D255 (WI-3a–3d) | 16.1M | 37.3M | **53.5M** | 4 | 36 | 57% / 61% | 10-22..10-26 |
| 3 | D319 (+F3) | 11.4M | 34.0M | **45.4M** | 12 | 23 | 42% / 59% | 10-24..10-27 |
| 4 | ADR-0047 harness (WI-004, WI010) | 26.9M | 2.4M | **29.2M** | 15 | 5 | 19% / 68% | 10-09..10-27 |
| 5 | ADR-0141 | 3.8M | 18.0M | **21.8M** | 6 | 26 | 51% / 1% | 10-25..10-26 |
| 6 | WI-0.4 (stage-0 screenshots) | 21.6M | 0 | **21.6M** | 1 | 0 | 9% / – | 10-04..10-07 |
| 7 | B7 (device batch + driver) | 5.6M | 15.5M | **21.0M** | 7 | 21 | 38% / 2% | 10-09..10-26 |
| 8 | D318 (/D320) | 1.6M | 15.4M | **17.1M** | 6 | 16 | 20% / 17% | 10-23..10-25 |
| 9 | D305 | 5.7M | 10.7M | **16.4M** | 7 | 16 | 48% / 94% | 10-22..10-27 |
| 10 | B1 | 3.0M | 11.1M | **14.1M** | 7 | 7 | 56% / 49% | 10-09..10-24 |

Next in line: D322 11.1M, B2 8.8M, D294 8.5M, B9 6.1M, D320 5.3M.

Notes on the top three:
- The single costliest session was Codex gpt-imple-1's first M1b pass: 234M input tokens in 3 hours (10-23 00:28–03:19).
- D255 spent 37M in Codex across 36 sessions, and its artifact folder holds 145 files: 58 first-pass and 80 rework (fix1–fix3, r2/r3, amendments 9–13).

### Top items by number of sessions touching them

| Item | Claude + Codex sessions | Total W | Dates |
|---|---|---|---|
| D255 | 4 + 36 = 40 | 53.5M | 10-22..10-26 |
| D319 | 12 + 23 = 35 | 45.4M | 10-24..10-27 |
| ADR-0141 | 6 + 26 = 32 | 21.8M | 10-25..10-26 |
| B7 | 7 + 21 = 28 | 21.0M | 10-09..10-26 |
| M1b | 2 + 22 = 24 | 54.5M | 10-22..10-26 |
| D305 | 7 + 16 = 23 | 16.4M | 10-22..10-27 |
| D318 | 6 + 16 = 22 | 17.1M | 10-23..10-25 |
| ADR-0047 | 15 + 5 = 20 | 29.2M | 10-09..10-27 |
| D322 | 3 + 17 = 20 | 11.1M | 10-26 |
| D320 | 4 + 15 = 19 | 5.3M | 10-24..10-25 |
| B2 | 15 + 1 = 16 | 8.8M | 10-09..10-27 |

### Spend by activity (Claude only; each call gets one bucket from its own tool calls)

| Activity | W | Share | Calls |
|---|---|---|---|
| Device tester (dtrack), GUI driving | 129.5M | 37.0% | 5,250 |
| Device tester, sleep/wait/log-tail calls | 49.0M | 14.0% | 1,875 |
| Other tool work (code reading, git, edits) | 58.5M | 16.7% | 1,648 |
| Polling/wait in the delegator and auditors (`herdr agent get/list/read/wait`, `sleep`, `gh pr checks`, TaskOutput) | 40.0M | 11.4% | 786 |
| Audit request writing, verdict merging, challenges | 35.3M | 10.1% | 857 |
| Reply with no tool call | 15.1M | 4.3% | 395 |
| Device work outside dtrack (osascript, logs) | 11.6M | 3.3% | 276 |
| Brief writing and dispatch | 6.3M | 1.8% | 141 |
| Landing, PR, audit-log records | 3.6M | 1.0% | 79 |
| Rulings (AskUserQuestion) | 1.3M | 0.4% | 22 |

Explicit "re-read rules/handoff" calls are tiny (about 6 calls). The real cost of the rules is that they ride along in every call's prefix (section 3), not that they get re-read.

**Delegator wake-ups.** In the main delegator sessions, 159 of the 241 turns started with a `<task-notification>` (a background wait completing), not a user message. Those turns cost 54.5M W, which is 48% of the main-session W, at about 0.34M per wake.

## 2. Rework vs first pass

Three independent estimates:

| Method | Rework share | Notes |
|---|---|---|
| Codex rollouts, classified by the prompt's file name: `fixN` / `amendment` / `resumed` = fix; `-r2`/`-r3` / confirm = re-audit; challenge; `ruling-N` / `grant-N` = resumed after a ruling | **37% of Codex W**: fix 26%, re-audit 7%, ruling-resume 4%, challenge <1% | gpt-imple-2: 58% of its W was fix rounds. gpt-auditor: 25% was r2+ confirms. |
| herdr-spike artifact files per item (brief, plan, matrix and r1 count as first pass; `fixN`, `-rN≥2`, confirm, amendment, challenge count as rework) | **51% of 1,024 files** (492 rework + 26 challenge) | D255 80/145, D319 59/93, D301 59/85, ADR-0128 36/54, D290 25/34 |
| Claude calls whose prompt or tool input matches fix-N≥2, r2+, confirm, challenge, re-run, amendment, retry | **28% of Claude W (99M)** | Noisy in both directions: "confirm" and "again" over-match, and dtrack re-runs that weren't named as such under-match. |
| Device batches | 4 of 15 0.3.6 batch ids are re-runs (B5b, B5c, B6b, B8c), about 10M W. 6 of 57 dtrack briefs are named r4/r5/r6. | |

**Best estimate:** about 30–40% of agent token spend went to rework (fix rounds, confirms, re-runs). That is roughly 100–130M Claude W plus 85M Codex W. This is a guess with about ±10 points of error.

The worst items by rework share:
- D305: 94% of its Codex W;
- D320: 75%;
- D255: 61%;
- D319: 59%;
- B1: 49%.

M1b's first pass was the expensive part (a single 234M-input session), not its rework.

## 3. Fixed overhead per session, and restarts

**Prefix size.** First-call context size is the system prompt, tools, CLAUDE.md, the always-on rules, memory and hook output:

| Session type | Median first-call context | Of which cache write |
|---|---|---|
| Main checkout, top level | 72k | 50k |
| Worktree sessions (opus-auditor, imple panes) | 106k | 78k |
| Claude subagents | 54k | 53k |
| dtrack | 61k | 35k |

**Project instructions.** These load into every repo session: CLAUDE.md 27.1 kB, AGENTS.md 13.1 kB, and rules 10/22/25/50/60/70/71 at 85.3 kB, for 125.5 kB in total. That is about 31–36k tokens (estimate at 3.5–4 bytes per token). Rules 70 and 71 alone are 65 kB, about 17k tokens. Most of their text concerns the delegator role, yet every implementor, auditor and subagent session carries it.

**What the prefix costs per call.** The prefix is re-read from cache on every API call:
- Repo-cwd Claude calls (4,199) × ~85k prefix ≈ 357M cache reads ≈ **36M W**. The project-instruction part alone is about 14M W.
- dtrack calls (7,125) × ~61k ≈ 435M cache reads ≈ **43M W**, which is 24% of dtrack's spend.
- Together the fixed prefix is about **80M W, about 23% of Claude W**. This is an estimate: it assumes the prefix stays constant and cached.

**Cold starts.** There were about 199: 75 dtrack sessions (one per brief, through /clear), 39 opus-auditor sessions (fresh per request, by design under ADR-0131), 74 subagents (mostly the landing verifier, 554 calls / 10.5M W; auditor/plan 277 calls / 9.1M W), 7 main sessions and 4 implementor panes. Their first-call cache writes total 9.75M tokens ≈ **19.5M W (5.6%)**.

**Compactions and long contexts.**
- Only 4 compactions happened in main sessions and 3 in dtrack.
- The delegator sessions ran 1.5–3 days each (8702731b 10-04..07, fa3ecb2f 10-22..24, b865b1e2 10-25..26), and context reached 964k before compaction. One manual compaction had preTokens 722k; an auto one had 412k.
- Median delegator context per call was 364k, and 61% of its calls ran above 300k.
- Cost per call by context size:

  | Context | Calls | W per call |
  |---|---|---|
  | under 200k | 482 | 24k |
  | 200–400k | 800 | 39k |
  | 400–600k | 597 | 65k |
  | over 600k | 372 | 86k |

- Calls above 400k context cost 70.9M W, 62% of main-session W.
- Mid-session cache rebuilds over 50k tokens happened 34 times in main (7.1M write tokens, about 14M W) and 71 times in dtrack (6.1M). Probable cause (a guess): the cache TTL expired during long background waits, so the next wake rewrote the whole context.

**Codex.**
- Median input per top-level session: gpt-imple-1 3.9M, gpt-imple-2 3.3M, gpt-imple-3 4.9M, gpt-auditor 1.0M.
- Every Codex session starts by reading AGENTS.md, CLAUDE.md and the 7 always-on rules by hand (AGENTS.md § Read first). That is about 30k+ tokens of reading per session, times 216 top-level sessions.
- The Codex delegator's single session on 10-24 used 198M input over 9 hours.

## 4. Polling loops and repeated identical calls

**Delegator polling** (main-session tool calls):

| Pattern | Calls | W |
|---|---|---|
| `sleep N; …` | 316 | 12.0M |
| `herdr agent get/list` | 182 | 10.2M |
| `herdr agent read` | 113 | 6.6M |
| `herdr agent wait` / `prompt --wait` | 72 | 2.4M |
| `gh pr checks` / `gh run` | 40 | 2.3M |
| `watch-agent` / `notify` | 61 | 2.2M |

- Total: about **36M W, 31% of main-session W**.
- Tight loops are rare: there were 54 runs of 3 or more consecutive poll-only calls (185 calls, 6.6M W; the longest was 6 calls).
- The cost comes from context size, not loop length. Each poll is cheap in tokens, but it re-reads a 360–960k context: a single `herdr agent get` at 600k context costs about 60–86k W.
- The most frequent poll shape was a 72-times-repeated `cd scripts/redesign/device; SP=…; sleep N …` device-log wait in session 8702731b. Next came `sleep N; herdr agent get gpt-imple-N | grep …` and `sleep N; gh pr checks N --watch`.

**Device tester:**
- 1,759 `sleep`-bearing Bash calls (27.8M W) and 1,584 screenshot/zoom actions (27.8M W).
- Identical calls repeated 3 or more times within one session: 218 groups, 1,496 redundant calls. Almost all were `mcp__computer-use__screenshot {}`, up to 79 times in one session, and one session ran the same `left_click_drag` resize batch 30 times.
- Each screenshot stays in the context, which is why dtrack contexts grow to a 151k median and up to 644k.
- `request_access` was called 92 times (8.6M W). That is the per-run Computer Use grant that /clear drops.

## The 5 biggest token sinks and a fix for each

**1. GUI device-test sessions (dtrack / mac-test): 178M W, 51% of all Claude W.**
- Typical cost is 2.4M W per batch session over about 170 calls.
- The context fills with screenshots (median 151k).
- sleep/wait calls are 49M W, and the same `screenshot {}` repeats up to 79 times per session.

*Fix:*
- Make the ADR-0047 driver (CDP/log assertions, `wait-for mdpro.log line`) the default probe, and take a screenshot only to prove a visual AC or when a step fails.
- Replace `sleep N; screenshot` with a blocking log-wait that returns one line.
- Run each item in a fresh subagent so the screenshots of item 1 don't ride along through item 10.
- Grant Computer Use per batch, not per item (92 `request_access` calls).

Expected saving: 40–60% of device W, about 70–100M (a guess).

**2. Delegator working at 300k–960k context: 114M W in main sessions, 62% of it from calls above 400k.**
- A call above 600k costs 3.6× a call under 200k (86k vs 24k W).

*Fix:*
- Cap the delegator's working context at about 200–250k: rotate or `/compact` at a fixed threshold instead of at 400–720k.
- Push every read of a report, diff or log into a subagent that returns a short verdict.
- The delegator keeps only SHAs, open findings and waits, which is already the compaction contract.

If the 969 calls above 400k had run at 200–250k, the saving is about 35–40M W (an estimate).

**3. Wake-ups and polling in the delegator: 159 notification turns, 54.5M W (48% of main), plus about 36M W of poll tool calls.**

*Fix:*
- One blocking waiter for all dispatched agents (`herdr agent wait` over the whole set, or `watch-agent.sh` fan-in) that wakes the delegator once and returns a ≤20-line digest: agent, state, report path, count line.
- Never use `sleep N; herdr agent get` or `gh pr checks --watch` inside the delegator. Run those in a background script that writes a file.
- Batch wake-ups: an implementor's handoff and its auditor's report arriving within minutes should cost one turn, not two.

Combined with fix 2, this should halve the per-wake cost, about 25–30M W (a guess).

**4. Rework rounds: about 37% of Codex W (≈85M) and an estimated 30–40% overall. 51% of herdr-spike artifacts are fixN, r2+, confirm or amendment files.**
- Concentrated in D255 (80 rework files, 61%), D319 (59 files, 59%), D301, ADR-0128, D305 (94% of Codex W) and D320.

*Fix:*
- Front-load the classes the audits keep finding. The High findings were lifecycle and race cases: close or switch during an await, stale token, batch interleave. Put these in the brief's AC and in the attacked matrix before round one, as a fixed checklist rather than a per-item discovery.
- Hold to ADR-0143's two-round cap and the "no C/H → merge" rule, so confirms don't spiral.
- Split High-tier items into smaller WIs only when the split reduces the scope each audit reads. D255's four WIs still took 2–3 rounds each.

Track rework share per item in `docs/audit/audit-log.md` so the effect is measurable.

**5. Fixed per-call prefix and cold starts: about 80M W for the re-read prefix (23% of Claude W) plus about 19.5M W in cold-start cache writes.**
- Repo sessions start at 72–106k tokens.
- About 33k of that is CLAUDE.md, AGENTS.md and 7 always-on rules, of which rules 70 and 71 are about 17k and mostly concern the delegator.

*Fix:*
- Move rules 70 and 71 out of the always-on set: give them `paths:` frontmatter or fold them into the `mdpro-delegator` skill, which only the delegator loads. Leave a 1 kB role summary always on.
- Trim CLAUDE.md's events table and ADR/ledger policy into `docs/guide/`.
- Give dtrack and subagents a minimal instruction set.
- Pass `MDPRO_ROLE` so role-irrelevant rules aren't loaded.

A 20k-token cut × about 11.3k Claude calls ≈ 226M cache reads ≈ 23M W, plus about 4M W less cold-start writing. Codex would save similarly: 216 sessions × the hand-read rules.

**Honourable mention (outside the transcripts asked for): the claude-mem observer.**
- Headless Haiku sessions that summarise mdpro sessions: 300 sessions, 85.6M cache-write and 882M cache-read tokens, 7.4M output.
- That is about 297M W in Haiku units, about 60M Opus-equivalent (a guess at the price ratio).
- Rule 70 already records it misbehaving.
- *Fix:* disable claude-mem capture for the dtrack and worktree project dirs, or entirely for mdpro, which already keeps its own handoffs and audit log.

## Estimation caveats (summary)
- W uses Anthropic price ratios applied to every model, so Codex W and Haiku W are only comparable in shape.
- Attribution is heuristic (sticky ids): about ±30% per item, and 13.7% of W is unattributed.
- Rework classification depends on file and prompt naming conventions. The Claude keyword method is noisy.
- MacBook-era sessions (before 10-22) are missing for the main checkout. Codex rollouts begin on 10-16.
- The prefix-cost estimates assume a constant cached prefix of the median first-call size.
