# Mac mini memory overload and kernel panic, 2026-10-28: post-mortem and decisions

Written by herdr-delegator on 2026-10-29, at the user's request:
「你把这次的CPU load和Memory 过载导致的Mac Mini停机等事项的始末，以及上面我们讨论后做的决定（目前沉淀在多个adr中，我需要有条理的整理出来），一起写一个md文档，做深度复盘，存入 docs/knowledge/，link 相关rule文档。」

The decisions live in [ADR-0150](../adr/0150-heavy-and-gui-runs-exclude-each-other-and-a-load-guard-stops-a-job-under-memory-or-cpu-overload.md),
[ADR-0151](../adr/0151-heavy-jobs-are-admitted-against-a-memory-budget-and-cpu-stops-only-the-job-that-causes-it.md) and
[ADR-0152](../adr/0152-an-unreadable-memory-pressure-reading-on-macos-holds-the-job.md). This page puts them in one order
and explains how we got there. Where it and an ADR disagree, the ADR is the decision.

**Evidence markers:** **[V]** verified from a log, a command, a file or git; **[I]** inference.

## 1. Summary

- **What happened.** On the evening of 2026-10-28 the Mac mini (10 cores = 4 P + 6 E, 16 GiB) ran out of memory for half
  an hour, macOS killed background services one after another, WindowServer stopped answering, and the kernel's watchdog
  panicked the machine. It rebooted at 23:23. [V]
- **Why.** Several `node` processes, each allowed V8's default heap ceiling of about 4 GiB, held most of the 16 GiB while
  mdpro and picsee test jobs ran beside them. No control on the machine looked at memory, before or during a job. [V]
- **Why our controls did not stop it.** Every control built since 2026-10-07 (the heavy lock, worker caps,
  load-following workers, timeouts) measures CPU or load. Memory was named twice as the real limit and deferred both
  times. [V]
- **What we decided.** One exclusion for heavy jobs and GUI runs; admission against a memory budget; a runtime stop at
  critical memory pressure; per-process heap caps; a CPU stop only when the guarded job is the cause; a launchd
  backstop for jobs started outside the wrappers. Agreed with picsee-delegator and mirrored in both projects.
  Every heavy and GUI run in both projects is paused until the guard is in place.

## 2. The incident, minute by minute

All times CST, 2026-10-28, from `/Library/Logs/DiagnosticReports` on the mini unless marked.

| Time | Event | Evidence |
|---|---|---|
| 13:49 | A Jetsam report lists no `node` process above 0.5 GiB | `JetsamEvent-2026-10-28-134929.ips` [V] |
| 20:55, 21:40–21:42 | picsee test processes crash (`xctest`, `Python`) | `~/Library/Logs/DiagnosticReports` [V] |
| 22:01 | First Jetsam (memory-pressure kill) of the evening. Four `node` processes, PIDs 528, 533, 554, 561, at 3.2–3.5 GiB each | `JetsamEvent-2026-10-28-220153.ips` [V] |
| 22:01–22:30 | Jetsam every few minutes; the same four PIDs grow to 4.2–4.3 GiB and stay there | 11 Jetsam reports [V] |
| 22:26 | picsee's `swiftpm-testing-helper` crashes | crash report [V] |
| 22:27 | gpt-imple-1 (mdpro, ADR-0147 WI-1) takes the heavy lock for a 2-worker full lane | its pane: `heavy-lock still waiting … held by pid=5302 started=2026-10-28T22:27:14` [V] |
| 22:29 | WindowServer user-space watchdog timeout | `WindowServer_…userspace_watchdog_timeout.spin` [V] |
| 22:30 | A fifth `node`, PID 44949, at 2.2 GiB; about 20 GiB of `node` in total | `JetsamEvent-2026-10-28-223009.ips` [V] |
| 22:32 | Last Jetsam report | [V] |
| 23:23 | Reboot | `last reboot` [V] |
| 23:24 | Kernel panic report: "watchdog timeout: no checkins from watchdogd in 94 seconds"; compressor at 39 % | `panic-full-2026-10-28-232436.0002.panic` [V] |

Jetsam killed `mediaanalysisd`, `homed`, `assistantd`, `routined`, `cloudd`, `trustd`, `softwareupdated` and others:
on macOS it only ever kills idle daemons and never a runaway foreground or test process
([XNU memorystatus docs](https://github.com/apple-oss-distributions/xnu/blob/main/doc/vm/memorystatus_kills.md)) [V]. With
nothing left to kill, the machine thrashed until the watchdog fired. [I]

## 3. Root cause

### 3.1 Direct cause: node processes allowed to grow to the V8 default ceiling

- `node -e 'require("v8").getHeapStatistics().heap_size_limit'` on the mini returns **4144 MiB** (Node 22.22.3); with
  `--max-old-space-size=2048` it returns 2096 MiB. [V] The four large processes plateaued at 4.2–4.3 GiB, which is that
  ceiling. They were allowed to grow that far; they were not necessarily leaking without bound. [V/I]
- Four of them at the ceiling is about 17 GiB on a 16 GiB machine, before WindowServer, the agents (about 4 GiB of
  Claude, Codex and Kimi processes run all the time) and picsee's tests. [V/I]

### 3.2 Which program those processes were: not determined

My first answer to the user said they were "gpt-imple-1's four vitest coverage workers". **That was overstated**, and is
corrected here:
- the four kept the **same PIDs** for 30 minutes, but mdpro's vitest uses the `forks` pool with default isolation, which
  replaces a worker after every test file (`createForksPool` sets `isolateWorkers`,
  `node_modules/vitest/dist/chunks/coverage.DL5VHqXY.js`) [V]. Per-file workers would change PID constantly;
- they did start that afternoon, after 13:49, not at boot (PIDs had wrapped after 12 days of uptime) [V];
- they fit vitest **main** processes aggregating coverage, possibly from several runs, or another node service, better
  than per-file workers [I]. The fifth (PID 44949) matches the time gpt-imple-1's 2-worker lane took the lock [I].

Jetsam reports carry process names only, so the program cannot be recovered. The guard now logs the top eight processes
by resident memory, with their command lines, at every stop and warning, so the next incident can be traced
(ADR0150-WI1 addendum 2).

### 3.3 Why the existing controls did not stop it

| Control | What it does | Why it did not help |
|---|---|---|
| `scripts/heavy-lock.sh` (shared by both projects) | serialises heavy jobs that go through it | Locked jobs did queue correctly, but it never reads memory or CPU, at admission or while a job runs [V] |
| Rule 10's unlocked runs | ≤ 2-worker RED/GREEN runs may run beside a locked lane | Their memory adds to the locked lane's with no check [V] |
| `~/.cache/desktop-gui.lock` | serialises GUI runs between projects | A GUI run did not take the heavy lock, so a GUI batch and a heavy lane could overlap [V] |
| `vitest.workers.ts` | 2 workers unlocked, 50 % of cores locked | Cores-based; says nothing about memory per worker [V] |
| ADR-0135 memory admission | would wait at critical pressure before starting | Accepted 2026-10-23, never built (D312) [V]; and it checks only at start |
| macOS itself | Jetsam | Kills idle daemons only, never a test worker [V] |

### 3.4 Why memory was never measured: the history

| Date | Event | What was decided then | Record |
|---|---|---|---|
| 2026-10-07 | Concurrent full vitest runs plus cargo pushed load to 60–160 and timed out lanes | One machine-wide lock; vitest at 50 % of cores. CPU only | commit `5879616d`; [rule 10](../../.claude/rules/10-tdd.md#how-much-to-run-and-when) |
| 2026-10-10 | A killed job left orphan workers beside the next job | The lock is released only after the whole process group exits (D75); one full run per commit | `ac9b0af8`, `3e450601`; [rule 10](../../.claude/rules/10-tdd.md#how-much-to-run-and-when) |
| 2026-10-11 | Load 45 on 10 cores with one locked lane: unlocked runs from three sessions stacked | Unlocked runs capped at 2 workers (D147, `bce24d3`) | `d4776db1`; [rule 10](../../.claude/rules/10-tdd.md#how-much-to-run-and-when) |
| 2026-10-21 | Workers set by load | ADR-0130: workers follow `cores − loadavg`; timeouts are liveness bounds. CPU only | [ADR-0130](../adr/0130-ci-coverage-runs-in-shards-workers-follow-load-and-test-timeouts-are-liveness-bounds.md) |
| 2026-10-22/23 | Both projects move to the 16 GiB mini | ADR-0134 draft r1 had a "whenever memory is short" clause; review asked who measures it and what counts as short; **removed** | [ADR-0134](../adr/0134-the-herdr-roster-moves-to-the-mac-mini-isolated-from-picsee.md) |
| 2026-10-23 | picsee held the shared lock with an idle shell for 22 minutes | ADR-0135: one shared tool, arrival order, **memory admission**. Its Context: "Admission ignores memory, and on this machine memory runs out before CPU." Queued as D312 after M1b and D255-WI-3d, then after the 0.3.6 lock. The user chose 「接受 (Recommended)」 | [ADR-0135](../adr/0135-one-heavy-lock-tool-serves-every-project-queues-in-arrival-order-and-admits-by-memory.md), [incident](../reference/20261023-heavy-lock-incident.md), [D312](../plans/20260912-frontend-backend-sequencing-order.md#d312) |
| 2026-10-27 | Load 14 with `launchservicesd` at 98.7 % CPU; d182, d183 and adr141 time out at load about 12 | Registered as flaky tests, cause not confirmed | session record; [D332](../plans/20260912-frontend-backend-sequencing-order.md#d332) |
| 2026-10-28 | Load about 47 in a verifier run; `codex-land-guard.test.ts` times out twice | Registered as D334, 「Accept, register D334 (Recommended)」 | [D334](../plans/20260912-frontend-backend-sequencing-order.md#d334) |

**Pattern** [I]: the overload signals of 10-27 and 10-28 were read as flaky tests, not as machine distress, and the one
control aimed at memory (D312) sat behind the release queue because it was tooling with no release pressure. Memory was
named as the limit twice and deferred twice: once as unmeasurable, once as not urgent.

## 4. Response on 2026-10-29

1. **Pause.** The user: 「你和picsee商量一个方法，不能同时跑GUI test或者全量的unit lane，跑测试的时候，实时监控Mac Mini的CPU负载情况，一旦超过95%，停下跑测试」,
   then 「Right; pause heavy runs (Recommended)」. mdpro stopped its in-flight verifier; picsee held its new heavy lanes
   and GUI runs. Audit panes that only read code kept going.
2. **Evidence before proposals.** The crash reports above, the lock's waiting log, the PID trace. The finding that it
   was memory, not CPU, changed the design: a CPU stop alone would not have caught it.
3. **Agreement with picsee-delegator**, by direct message (rule 71 allows it for the shared lock). picsee confirmed the
   evidence on its side and proposed the CPU change (a healthy Swift or xcodebuild compile keeps every core above 95 %
   for minutes) and the unreadable-reading rule.
4. **Outside opinions**, at the user's request (「你用subagent + Fable，让它搜索一下…同时也让Codex Weigh in」): a Codex
   review and a Fable survey of Google, Meta and Microsoft practice (§ 6).
5. **Slot.** Both implementation slots were full; the user chose 「Park WI-1」. ADR-0147 WI-1 was saved as WIP commit
   `7517d3b9` on its branch (patch backup in `~/.mdpro-redesign/handoff/`), and its implementor took the guard
   (ADR0150-WI1).

## 5. The decisions, in one place

### 5.1 Exclusion and admission

| # | Decision | User's word | Record |
|---|---|---|---|
| 1 | At most one of {full unit lane, `xcodebuild test`/`swift test` lane, `cargo test`, `tauri build`, GUI batch} runs on the machine. A GUI run takes the heavy lock **and** the GUI lock (picsee's flock first, then `~/.cache/mdpro-heavy.lock`, then `~/.cache/desktop-gui.lock`) | the requirement above | ADR-0150 decision 1 |
| 2 | A job starts only when pressure is 1 **and** free memory (free + inactive + purgeable from `vm_stat`) ≥ its budget + 4 GiB. Budgets are per job class, summed RSS over the job's process group, from a measured peak + 20 %; 9 GiB until measured, for every class in both projects | 「Adopt all (Recommended)」 | ADR-0151 decision 1 |
| 3 | Warning pressure (2) never starts a job: wait, then exit 75 at the deadline. Replaces ADR-0135's "start after 5 minutes" | 「Adopt all (Recommended)」 | ADR-0151 decision 2 |
| 4 | Pressure levels are the libdispatch constants NORMAL 1, WARN 2, CRITICAL 4, not XNU's internal 0–4 table | 「Document pressure levels 1/2/4」 | ADR0150-WI1 addendum 4 |
| 5 | On macOS an unreadable or unexpected reading counts as WARN (no start, deadline 75, log `pressure=unreadable`); on other hosts (CI's Linux runners) it starts with a logged note | 「Split by OS (Recommended)」 | ADR-0152 |

### 5.2 Stopping a running job

| # | Decision | User's word | Record |
|---|---|---|---|
| 6 | Memory: pressure 4 for 2 consecutive 5-second samples stops the job | 「Memory stop + CPU cap (Recommended)」 | ADR-0150 decision 3 |
| 7 | CPU: machine busy > 95 % for 3 samples always pauses admissions and logs; it stops the guarded job only when that job's own process group is > 80 % of the busy CPU. The metric is total CPU busy % | 「CPU busy % (Recommended)」, 「Attribute before stopping (Recommended)」 | ADR-0151 decision 4 (replaces ADR-0150 decision 3's CPU clause) |
| 8 | A stop sends TERM to the process group, KILL after the grace, releases the lock after the group exits (D75 unchanged), and exits **76**; 75 stays lock or admission timeout | — | ADR-0150 decision 3 |
| 9 | Every stop or warning writes one JSON line to `~/.cache/load-guard.log` with the readings and the top eight processes by RSS (pid, ppid, RSS, elapsed, command cut at 200 characters, no environment or tokens) | — | ADR-0150 decision 3; ADR0150-WI1 addendum 2 |
| 10 | After an exit 76: no immediate retry; at most one retry after 10 minutes at pressure 1, with less parallelism; a second stop goes to the owner. A worker that exceeds its own heap cap is a test failure, never retried | 「Adopt all (Recommended)」 | ADR-0151 decision 5 |

### 5.3 Per-process limits and parallelism

| # | Decision | User's word | Record |
|---|---|---|---|
| 11 | mdpro's locked full vitest lane: **2 workers** by default, at most 3 when the measured peak fits; each worker `--max-old-space-size=2048`. Not cores − 2, which would be 8 workers, about 24 GiB | 「Adopt all (Recommended)」 | ADR-0151 decision 3 |
| 12 | mdpro's unlocked runs (`heavy-lock.sh --guard-only`): `--max-old-space-size=1024` per worker | 「1024 MiB heap for unlocked runs (Recommended)」 | ADR0150-WI1 addendum 4 |
| 13 | picsee: compiles at `-j 8` / `-jobs 8` (cores − 2); one test process per job; it refuses `--parallel`, `--num-workers` or `-maximum-parallel-testing-workers` above 2 | picsee-delegator, under the same rulings | picsee's mirror |

### 5.4 The backstop and the unguarded paths

| # | Decision | Record |
|---|---|---|
| 14 | `heavy-lock.sh --guard-only` applies the guard without the lock, for unlocked runs | ADR-0150 decision 5 |
| 15 | One launchd agent, owned by mdpro (`scripts/load-guard/`), applies the same thresholds to jobs started outside the wrappers. It TERMs only allowlisted test-runner process groups matched by executable path and argv (vitest workers, `xctest`, `swiftpm-testing-helper`, `cargo` test binaries); never a build, signing, `Picsee.app`, an agent, an editor or a GUI app | ADR-0150 decision 6; addendum 1 (picsee's runner shapes) |
| 16 | A wrapper registers each job it runs (`~/.cache/load-guard/active/<pgid>.json`); the backstop never stops a registered group. Before any kill, both re-check pid, start time and owner | ADR0150-WI1 ruling 1 |
| 17 | The implementor writes the installer; the delegator installs the agent after landing, with the user's word | ADR0150-WI1 brief § 2 |

### 5.5 Process

| # | Decision | User's word | Record |
|---|---|---|---|
| 18 | ADR-0150 accepted on the user's word, plan review folded into the PR's High-tier audit by both auditors; rule 12 does not apply (process tooling) | 「Fast: your word + PR audit (Recommended)」 | ADR-0150 Status |
| 19 | One measured full coverage lane (3 workers, through the new wrapper, worker and main-process RSS sampled) sets the final worker cap and the vitest budget | — | ADR-0150 decision 7; ADR-0151 decision 3 |
| 20 | Phase 2: D312's shared heavy-lock tool absorbs all of this; until then each project's wrapper carries it, picsee mirroring mdpro's diff | — | ADR-0150 decision 8 |
| 21 | **The pause lifts** only when mdpro's wrapper and backstop have landed, picsee's mirror is merged, picsee has tested an exit-76 stop end to end, and both projects confirm to each other | picsee-delegator's condition, accepted | ADR-0150 decision 9 |

## 6. What outside practice says, and how we compare

From the Fable survey (sources in its report) and the Codex review, both 2026-10-29.

| Practice | Who | Ours |
|---|---|---|
| Each task declares resources and the scheduler admits against them | Bazel `size`/`resources:`, `--local_resources`; Buck2 `memory_max_per_action`; Kubernetes requests | Decision 2, budgets per job class |
| Stop admitting under machine memory pressure before killing anything | BuildXL `MaxRamUtilizationPercentage` 90 %; macOS BuildXL's pressure levels | Decisions 2, 3, 7 |
| Act on sustained pressure, early, in user space, because the kernel acts too late | Meta oomd and systemd-oomd (PSI > 60 % for 30 s) | Decision 6 (pressure 4 for 10 s), the backstop |
| A per-process memory cap next to the machine check | Jest `workerIdleMemoryLimit` 1–2 GB in Backstage, Grafana, Kibana; Buck2 per-action limits | Decisions 11, 12 (V8 heap caps: the only enforceable per-process limit on macOS, since `ulimit -v` is refused) |
| Retry a job the environment killed; fail a job that broke its own cap | BuildXL, Buck2 `KillAndRetry` | Decision 10 |
| CPU caps concurrency; nothing kills on CPU % | every surveyed system | Decision 7 is stricter than that: it stops a job only when the job itself is the cause. The warn-only alternative was offered and not chosen |

The survey's alternative of 4 workers at 1536 MiB fits the same budget as our 2 at 2048 MiB; decision 19's measurement
settles it.

## 7. Open items

| Item | Owner | State on 2026-10-29 |
|---|---|---|
| ADR0150-WI1: the wrapper, `--hold`, `--guard-only`, the backstop and its installer, the vitest caps, the guide, the measured run | gpt-imple-1, branch `chore/adr0150-load-guard` | in implementation; then a High-tier audit by both auditors |
| picsee's mirror and its end-to-end exit-76 test; measured budgets for its SwiftPM, App and GUI classes | picsee-delegator | waiting for mdpro's diff |
| ADR-0150 WI-2: one lane entry point (`scripts/lanes/run.sh`, `pnpm lane:*`), `test:run`/`coverage`/`rules:check` routed through the guard, `role-guard.sh` and Codex rules refusing raw `vitest --coverage` / `pnpm coverage`, and a thin `.agents/skills/mdpro-lanes` Skill | unassigned, after WI-1 lands | approved by the user: 「Yes, as ADR-0150 WI-2 (Recommended)」 |
| Installing the launchd backstop | herdr-delegator, with the user's word | after landing |
| D312: the shared tool (phase 2) | unassigned | queued |
| D332, D334: load-sensitive timeouts | PR #549 at the cap, landed open per 「Land open, track」 | waiting for the pause to lift |
| Which program the 4 GiB `node` processes were | — | unknowable from the crash reports; the new log line covers the next time |
| ADR-0147 WI-1 | gpt-imple-1 | parked at `7517d3b9` |

## 8. Lessons

1. **Measure the resource that runs out, not the one that is easy to read.** Load average and CPU were measured from
   10-07 on; memory, which ADR-0135 already called the binding limit, was never measured until a crash.
2. **A safety control deferred behind a release is a bet.** D312 had no release pressure, so it lost every slot
   decision. The bet was lost five days later. Put the cheapest slice of a safety ADR in first (here: a pressure check in
   the existing wrapper), and queue the full tool after.
3. **Repeated "flaky" timeouts under load are a machine signal.** D332 and D334 were registered as test problems on the
   same two days the machine was at load 12–47.
4. **A guard must cover every path that can start the load**: the locked lane, the unlocked runs, the GUI runs, and work
   started by hand. One unguarded path is enough.
5. **Separate what the evidence shows from what it suggests.** "Four vitest workers" was a plausible reading I stated as
   fact; the stable PIDs disproved it. Write down the inference as an inference, and log enough (pid, command line) that
   the next post-mortem does not have to guess.
6. **Two projects on one machine need one agreement, not two rules.** The fix only works because picsee adopts the same
   lock order, thresholds, exit codes and log, by direct agreement between the delegators.

## 9. Related rules and records

- Rules:
  - [rule 10 § How much to run, and when](../../.claude/rules/10-tdd.md#how-much-to-run-and-when): heavy-lock use,
    unlocked runs, worker caps;
  - [rule 10 § Environment and the slow tier](../../.claude/rules/10-tdd.md#environment-and-the-slow-tier);
  - [rule 70 § The Mac mini](../../.claude/rules/70-multi-session-coordination.md#the-mac-mini) and
    [§ Device-check batches](../../.claude/rules/70-multi-session-coordination.md#device-check-batches);
  - [rule 71 § Roster](../../.claude/rules/71-herdr-mixed-roster.md#roster): device panes, the GUI lock, messaging
    picsee-delegator about the shared lock;
  - [rule 71 § Slots](../../.claude/rules/71-herdr-mixed-roster.md#slots);
  - [rule 25](../../.claude/rules/25-careful-mode.md) for removing worktrees and the PC snapshot.
- ADRs: [0130](../adr/0130-ci-coverage-runs-in-shards-workers-follow-load-and-test-timeouts-are-liveness-bounds.md),
  [0134](../adr/0134-the-herdr-roster-moves-to-the-mac-mini-isolated-from-picsee.md),
  [0135](../adr/0135-one-heavy-lock-tool-serves-every-project-queues-in-arrival-order-and-admits-by-memory.md),
  [0150](../adr/0150-heavy-and-gui-runs-exclude-each-other-and-a-load-guard-stops-a-job-under-memory-or-cpu-overload.md),
  [0151](../adr/0151-heavy-jobs-are-admitted-against-a-memory-budget-and-cpu-stops-only-the-job-that-causes-it.md),
  [0152](../adr/0152-an-unreadable-memory-pressure-reading-on-macos-holds-the-job.md).
- Records: [2026-10-23 heavy-lock incident](../reference/20261023-heavy-lock-incident.md);
  [desktop GUI lock agreement with picsee](../reference/20261027-desktop-gui-lock-agreement-with-picsee.md);
  [D329 interop check](../test/20261028-d329-gui-lock-interop-check.md);
  sequencing rows [D75](../plans/20260912-frontend-backend-sequencing-order.md#d75),
  [D147](../plans/20260912-frontend-backend-sequencing-order.md#d147),
  [D312](../plans/20260912-frontend-backend-sequencing-order.md#d312),
  [D332](../plans/20260912-frontend-backend-sequencing-order.md#d332),
  [D334](../plans/20260912-frontend-backend-sequencing-order.md#d334).
- Code: `scripts/heavy-lock.sh`, `vitest.workers.ts`, `vitest.config.ts`,
  `.agents/skills/mdpro-delegator/scripts/gui-lock.sh`; after ADR0150-WI1, `scripts/load-guard/` and
  `docs/guide/load-guard.md`.
- Off-repo: the implementation brief, ruling and addenda 1–4 under `~/.mdpro-redesign/herdr-spike/gpt-imple-1/ADR0150-WI1-*`;
  the guard log `~/.cache/load-guard.log`.
