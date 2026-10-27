# Repeated development in mdpro: where the tokens went, and why (recall, 2026-10-27)

Read-only recall over Claude Code history plus the repo and herdr records. No repo file was edited.

## Sources and coverage

- **Claude transcripts on this Mac mini.**
  - Delegator: `fa3ecb2f` (10-22 to 10-24, 26 MB, about 2 to 5 compactions) and `b865b1e2` (10-25 to 10-26, 15 MB, 1 manual `/compact` plus overflows).
  - Device testers: `-Users-jack--mdpro-redesign-dtrack`, 75 sessions, 1.1 GB, mostly screenshots.
  - Auditors: `-wt-opus-auditor`, 20+ sessions.
  - Claude implementors: `-wt-gpt-imple-1/2`.
- **Not in Claude history:**
  - Delegator transcripts from before 10-22, which ran on the MacBook.
  - All Codex agents (gpt-imple-*, gpt-auditor).

  For these, the evidence is their files under `~/.mdpro-redesign/herdr-spike/<agent>/` (briefs, amendments, rulings, handoffs, round reports) and the repo records:
  - `docs/plans/20260912-frontend-backend-sequencing-order.md` D rows;
  - `docs/audit/audit-log.md`, including § Gate exceptions and § Fresh-context cost;
  - `docs/audit/escapes.md`;
  - `docs/test/2026102*-device-check.md`.
- **Mention counts across all mdpro transcripts.** These are a rough proxy for token mass: D319 7,840, D255 6,775, D305 4,852, D317 3,660, D261 2,497, D322 2,347, D318 1,883, D291 1,822, D294 1,599, D290 1,391.

**Unit cost of one extra round** (audit-log § Fresh-context cost): one gpt-auditor request uses **0.67M to 1.54M input tokens** (85 to 92 % cached) and 3K to 6K output, over 100 to 270 s. Under ADR-0143 a round is two auditors plus a challenge or rebuttal and a fresh implementor fix session. So **each extra audit round costs roughly 2 to 4M input tokens before any implementation work.**

---

## Top items (worst first)

### 1. D261 → D319: menu action goes to the wrong window. Four implementations of one behaviour, each built on a different, unverified model of AppKit event order

**Cycles:**
- **D261 WI-1.** Landed 10-18 (PR #503, 2 audit rounds). It resolved the target from focus when the event reached Rust.
- **B5c on 10-24 found it fails.** mac-test, `fa3ecb2f` 2026-10-24T01:26:47: "D261 FAIL (step 2 focus race acts in the other window 2/2)". This was registered as D319.
- **D319 Fix 1 + Fix 2** (gpt-imple-1, 10-24):
  - 12 briefs, grants and rulings: `D319-brief`, `ruling-1/2`, `grant-2/3`, `fix1-brief`, `fix2-brief`, `fix2-ruling-1`, `fix2-review-ruling-2`, `fix2-resume-brief`, and more;
  - 3 audit rounds: gpt r1 H3, r2 H1; opus r1 H1, r2 H1; then **opus r3, granted by the user as an exception** (ADR-0142, 「Grant opus round 3 (Recommended)」);
  - receipt exception G-D319-1.
  - Landed `9b9cd404` at `b865b1e2` 2026-10-25T04:49:10.
- **B8 failed on device less than 3 h later.** `b865b1e2` 2026-10-25T07:28:35: "D317, D318 and D320 pass, but D319 fails on the real device". It went 4/4 Highlight and 2/2 Save, and the Save wrote B's file.
- **Fix 3** (opus-imple-1, 10-25): PR #539, another round with a gpt H2 rebutted by opus. Then **B8b**, aborted on an API error and re-routed from opus to gpt-auditor, and **B8c**, which passed.

**Totals:** 4 implementations, 7 audit rounds, 9 auditor reports, 4 device runs (B5c, B8, B8b, B8c), 2 user exceptions.

**Why it had to be redone:**
- **A wrong root-cause model that tests could not falsify.**
  - Fix 1+2's tests fed synthetic notifications in the order "Begin → focus B → WillSend" while the session was still alive.
  - The Fix 2 AppKit probe (`D319-fix2-appkit-probe.swift`) proved only the menu *shape* (`Edit before=2 after=9 extras=7`), not the *event order*.
  - The handoff itself says "No device behavior is claimed" (`gpt-imple-1/D319-handoff.md:115`).
  - The real order, found only after the B8 logs, is that DidEndTracking fires before ⌘\` and the menu rebuild, and WillSend comes last. The old code had already dropped the session at End (`b865b1e2` 2026-10-25T12:29:13).
  - Fix 3 succeeded largely because it added `menu.capture` step logs, so the device run showed the mechanism directly.
- **Device verification came after landing.**
  - All three audit rounds read the diff, and none could see the platform ordering.
  - `escapes.md` rows 2 and 3 are exactly this item, twice: D261 and then D319 Fix 1+2.

### 2. D255 family (WI-3a/3b/3c/3d + M1b): shortcut and command parity. Scope discovered through brief amendments, Linux-only CI failures, and the receipt gate

**Cycles:**

| Unit | PR | Audit rounds | Other cycles | Exceptions |
|---|---|---|---|---|
| WI-3a | #524 | 1 | — | — |
| WI-3b | #528 | 3 + a post-cap fix 3 | **16 brief amendments on one day (10-22)** | G528-1…4 |
| WI-3c | #532 | 2 | — | G532-1 |
| WI-3d | #529 | 3 (r1 C0 H4) | — | G529-1 |
| M1b | #530 | 3 (r1 H4, r2 H1, r3 H0) | 12 SEPARATION-BROKEN receipts | G-M1b-1 |

There were 31 auditor reports in total, and the device batches B5, B5b, B5c, B6 and B6b. D318 and D320 came out of those batches, each with its own PR (#535, 2 rounds).

**Why it had to be redone:**
- **Under-scoped briefs.** A key binding is read in many places: TS resolver, Rust readers, inventory scanner, saved prefs, platform keymaps. Each was found mid-run and needed a new path grant, from Amendment 4 to Amendment 16 (`gpt-imple-2/D255-WI-3b-brief.md:416-645`).
  - **Amendment 12 was a wrong ruling and was withdrawn by Amendment 13.** The one-owner guard broke ⌘⇧L, which needs both handlers (`D255-WI-3b-blocked.md`).
- **Only Linux CI saw the failures.**
  - WI-3b: 7 Rust tests expected macOS keys on ubuntu. This was found after all 3 rounds closed, and needed a 4th change outside the cap (G528-3, `D255-WI-3b-fix3-brief.md`).
  - WI-3d r1 H1: a test imported a fixture that exists only on macOS (`fa3ecb2f` 2026-10-23T02:52:26).
  - M1b C-H3 was "held for Linux".
- **The receipt gate.** The `SEPARATION-BROKEN` exceptions needed a user ruling on almost every PR (see item 7).

### 3. D290 (⌘S after an Ignored delete) and WI-4.3b (settings writes): one lifecycle interleaving found per audit round

- **D290, PR #515, 4 rounds.** Round 4 was an exception to ADR-0120, by the user's 「Allow 4th fix round (Recommended)」. Each round found a new "something happens during an await" case:
  - r1: a close during the preferences await;
  - r2: an independent lifecycle generation;
  - r3: a reload with identical content but new metadata;
  - and so on.

  There were 11 auditor reports and 4 fix briefs (sequencing row 727).
- **WI-4.3b, PR #508, 5 rounds.** It produced F508-1a/1b/2/3: a late or stale read overwrote a newer write, a remount reset siblings, and a group write crossed windows. The handoff folder has `wi43b-round2/3/4-handoff`.
- **The same pattern** appears in D305 (#531, 3 rounds: a queued Discard erased a newer backstop draft), D299 (#519, 2 rounds, plus escape row 1 → D315 on device), and D291 (#517, 2 rounds, then device FAIL → D314).

**Why it had to be redone:** the test matrix listed interleavings by hand. Auditors then found the missing ones one per round. Each round is a fresh pane that rereads the diff, at about 2 to 4M tokens. The D323 row now names this class: D319, D261, D290, D299 and D305 are all "an await during which something else happens".

### 4. D294: secondary-window close crash. A blind mitigation loop on a platform crash

**Cycles:**
- Device trials on 10-20 (dtrack `f787aab4`).
- Phase A mitigation PR #523, then a Phase B device run on 10-22 (`5cce9f2c`): FAIL, 1 crash in 30 closes.
- A diagnostic PR #525 (D294-R), then device RA (`e5f1a9ec`) and RB (`1052c569`): "two variants indistinguishable" (1/16 against 0/16, on the same 0x638 stack).
- Shipped as a Known issue under ADR-0132.

**Why:** each mitigation was a hypothesis about WebKit internals that could only be tested by about 15 to 30 counted closes on the device. The user bounded it explicitly: 「One bounded test round, then B (Recommended)」. This was the right outcome, but only after two full audited PRs.

### 5. D322: dev build release id. A SHOULD tooling change that stopped 5 times before review

**Cycles:** `gpt-imple-1/D322-handoff-stop1…5.md`, all on 10-26 between 15:30 and 16:28, then the final handoff. Then PR #541 with 2 audit rounds (r1 H1: Bash interpolation of `${{ steps.version.outputs.VERSION }}`) and receipt exception G541-1.

**Why:**
- stop1: an AC asked for a comment edit in `app_ready.rs`, outside the path grant. The brief's scope did not match its own AC.
- stop2 and stop3: the spec-adversary kept finding gaps, and the brief said "stop if gaps remain after two attack rounds".
- stop4: a pre-existing D187 test failed in the full lane.
- stop5: the TDD review found H0 M5, and the plugin workflow stops on CHANGES REQUESTED even though rule 71 says no C/H does not block.

Each stop was a delegator ruling and a pane restart. **The process ceremony was sized for High-tier product code and applied to a routine tooling item.**

### 6. ADR-0141 WI-1 (Codex role guard): the fix for the stalled Codex delegator, itself stalled by the environment

**The trigger.** The Codex delegator produced **no commits for about 6 h on 10-24**.

`b865b1e2` 2026-10-25T02:29:32:

> "The Codex delegator ran under the guard written for implementors, so it couldn't land anything … `.codex/rules/mdpro.rules` … forbids `git push`, `gh pr create/merge`"

Its user decisions also "sat in files instead of reaching you". picsee had already solved this in its PR #93 (02:37:07).

**The fix's own cycles (10-25):**
- a 5 s test timeout, treated as an environment stop;
- Node v24 against the project's Node 22 (07:56);
- PATH without `/usr/sbin`/`lsof` (08:59);
- Codex failed to start in a new pane until the third retry (09:01);
- a final review High (`push.followTags`);
- the CI inventory gate needed the 16 Codex-dependent skips registered, found only on the ubuntu runner (11:54).

That is 3 fix rounds plus 2 audit rounds.

**Why:** an unpinned toolchain and environment across panes; a test environment that differs from CI; and a guard configuration that was never tested per role.

### 7. The RED-receipt gate: the same ruling requested on most PRs

`audit-log.md` § Gate exceptions has 19 rows. **14 of the 23 PRs from #518 to #541** carry a receipt exception: G518-2, G519-1, G522-1, G523-1, G527-1, G-M1b-1, G528-1/2, G529-1, G531-1, G532-1, G-D318-1, G-D319-1, G-D317-1, G541-1.

Each one cost:
- a delegator proposal file (`herdr-spike/delegator/*-receipt-exception-proposal.md`);
- an AskUserQuestion round;
- often "substitute evidence" REDs built by hand;
- and for the Codex delegator on 10-24, a full stall.

**Root cause** (`docs/reference/20261027-receipt-separation-broken-causes.md` §1):
- The tool fingerprints whole files line by line. Any edit to any recorded non-blank line, including an import, a fixture or a rustfmt join, flips the receipt to BROKEN for good.
- No line text is stored, so every exception "had to be reconstructed by hand".
- The census shows 67 BROKEN out of 710 receipts.

**The 10-27 assessment's claim is confirmed:** most PRs waive it. ADR-0145 (untracked) is the response.

### 8. Device batches re-run for reasons other than product defects

| Batch | Why it was re-run |
|---|---|
| B5 → B5b → B5c | B5 "ran out of steps". In B5b, Computer Use returned `Screenshot unavailable`. The B5 brief "wrongly asked for a tab list", which is a card error (`20261024-b5-…md:13-16`). In B5c a picsee GUI took the front during mdpro's lock. |
| B6 → B6b | picsee drove the GUI "about 10:54–11:05 during the lock"; every step in that window was re-run (`20261024-b6b-…md:5`). |
| B8b → B8c | API connection error, then the device role was re-routed (opus → gpt-auditor, user 2026-10-25T13:28:58). |
| B1, first run | Voided: it tested a v0.3.5 release launched by bundle id (rule 71). |
| D291 / D291b | A follow-up brief. |
| D294 trials | Four device sessions (see item 4). |

**Confirmed:** device cards are delegator-written and unreviewed. 62 cards live outside the repo in `~/.mdpro-redesign/device/v036-owed-work/cards/` (assessment §4). At least one brief error forced a re-run.

---

## Root-cause taxonomy

| # | Class | Items | Recurring? |
|---|---|---|---|
| R1 | **Platform or behaviour assumption verified only on device, after landing** | D261, D319 F1+2, D291 → D314, D299 → D315, D294 | **Yes, the costliest.** 3 escape rows, 4 device FAILs on landed code |
| R2 | **Interleaving or lifecycle cases found one per audit round** (hand-written matrix) | D290 (4 rounds), WI-4.3b (5), D305 (3), D299, D291, M1b | **Yes.** Every 3+ round product PR |
| R3 | **Brief scope or AC mismatch** (under-scoped grant, AC outside the path grant, card error) | D255-WI-3b (16 amendments, one reversed), D322 stop1, B5 card | Yes |
| R4 | **macOS-only local gates; the Linux CI or runner difference found late** | D255-WI-3b fix 3, WI-3d H1, M1b C-H3, ADR141 CI inventory | Yes, 4 PRs |
| R5 | **Gate false positives → repeated user rulings** (receipt BROKEN, pre-existing clippy, review M-only stops) | 14/23 PRs; D322 stop5; G-SKILLS-1 | **Yes, nearly every PR** |
| R6 | **Environment or tool instability** (Node version, PATH, Codex start, API errors, Computer Use screenshots, shared desktop) | ADR141-WI1, B5b, B5c, B6b, B8b | Yes |
| R7 | **Process and roster churn** (rules rewritten mid-flight, role re-routing, wrong-role guards) | Codex delegator 6 h stall; device tester re-routed 4 times; second auditor Fable → Opus → retired → back | Yes, see below |
| R8 | **Over-ceremony for small items** (High-tier pipeline on routine or tooling work; tooling for the gate audited like product) | D322; #516 ADR-0125 receipt tooling (3 rounds, F516-1 r1/r2/r3 each a new escape form), #518 D301 (3), #522 ADR128+D302 (3) | Yes |

## Process-level repetition (not tied to one feature)

- **Rule churn.**
  - 34 commits to rules 70/71 between 10-16 and 10-27: 7 on 10-25, 6 on 10-23.
  - About 20 of ADR-0115…0145 are about process (audit count, rounds, roster, effort, models, slots).
  - The audit round cap went 3 (ADR-0120) → exception for 4 → 2 (ADR-0142/0143).
  - The second auditor went Fable (0115) → Opus pane (0137) → "only rely on gpt-auditor" (user 10-24) → optional → mandatory again (0143).
  - Device testing moved dtrack → claude-imple-1 → gpt-imple-3 (10-23) → opus-auditor (interim) → gpt-auditor (10-25).
  - Every change means briefs, request templates and heartbeat edits, and agents working under stale rules (for example D322 stop5).
- **The delegator re-derives state after compaction or rotation.**
  - `fa3ecb2f` has 2 to 5 "continued from a previous conversation" restarts.
  - `b865b1e2` has 2 more plus a manual `/compact`.
  - There have been 5 herdr-delegator handoffs since 10-21, plus the Codex ↔ Claude delegator swaps (10-24 to Codex, 10-25 back). On 10-25 the first hour went into finding out why Codex had produced nothing.
- **Repeated user questions.** 「距离 0.3.6 还有哪些」 ("what's left before 0.3.6") was asked on 10-24T00:21, 10-25T03:43 and 10-26T07:36. Each answer was re-derived from rows, heartbeat and PRs, so no single status view existed.
- **The same gate-exception ruling** was requested about 14 times (item 7).
- **Implementor restarts.** Context caps (ADR-0133: 20 % at a stop, so a new pane) plus environment stops gave several restarts per item: ADR141-WI1 had at least 4 panes, D319 at least 3.

## Recommended best practices, each tied to its evidence

1. **Make device proof a landing gate for behaviour ACs (ADR-0144 direction), and instrument before you fix.**
   - Evidence: R1, D319 (landed 04:49, device FAIL 07:28), escapes rows 1 to 3.
   - Before any fix for a platform-ordering bug, land a logging-only change, or run a probe on the real app, that records the event sequence (as `menu.capture` did in Fix 3). Write the root-cause hypothesis into the brief as a claim the device log must confirm.
   - Run the device card on the PR head's verify build *before* `--ff-only`, not in the next batch.
2. **Use model-based or property tests for lifecycle and race surfaces** (D323), instead of hand-listed interleavings.
   - Evidence: R2. D290 needed 4 rounds and WI-4.3b 5, each finding one more interleaving at about 2 to 4M tokens per round.
   - One state-machine model for save, close and draft, plus menu routing, with generated event orders, replaces the auditor's role as interleaving generator.
3. **Scope briefs by impact analysis, not by guessed paths.**
   - Evidence: R3. WI-3b had 16 amendments; D322's AC sat outside its own grant.
   - Before the grant, have the implementor (or a prep pass) grep every reader or writer of the changed contract, such as `MDPRO_RELEASE_ID` or the shortcut keys, and propose the path list. The delegator approves it once.
   - Lint the brief so every AC's files are inside the grant.
4. **Run the Linux CI lane before audit round 1** (push the PR head first, as was done on 10-22T14:58), and require `#[cfg(target_os)]` or host-flip tests for platform keymaps.
   - Evidence: R4. 4 PRs found ubuntu-only failures after audits, one needing a post-cap fix 3.
5. **Fix the receipt gate rather than ruling on it per PR** (ADR-0145).
   - Evidence: R5. 14 of 23 PRs had exceptions, 67 BROKEN receipts, and each needed a hand-built substitute and a user question.
   - Fingerprint only the assertions of the named test, store line text so a diff can be shown, and allow a superseding RED. Until then, pre-authorize one standing exception class with mechanical evidence, so the delegator does not ask the user every time.
6. **Tier the pipeline by risk, and do not stop on findings that cannot block.**
   - Evidence: R8, D322's 5 stops, and the 3-round audits of gate tooling (#516, #518, #522).
   - Routine or tooling items: one attack round, no stop on a review that is Medium-only (align the tdd-guardian workflow with rule 71's "no C/H → proceed"), one audit round with a Low-tier auditor.
   - For gate tooling, define the closed set of inputs it must handle before auditing, so each round cannot invent a new escape form (F516-1 r1/r2/r3).
7. **Pin the environment and preflight panes.**
   - Evidence: R6. ADR141-WI1 lost hours to Node 24 against 22, a PATH missing `/usr/sbin`, Codex start failures, and a timeout treated as an environment stop.
   - Have one `env-preflight.sh`, run on pane start, that checks the Node version, PATH tools, codex, the heavy lock and the GUI lock, and refuses to start a brief when any fails.
8. **Version the device cards in the repo, derive them from ACs, and review them before a run. Keep batches small.**
   - Evidence: R3 and R6. B5's card error, B5 running out of steps, and picsee collisions forcing B5b, B5c and B6b.
   - Cards live under `tests/manual-fixtures/cards/` (assessment rec. 3) and are reviewed with the plan.
   - Desktop exclusivity is enforced by the lock in both projects, not by the user's word.
9. **Freeze process changes during a release push, and test role configuration.**
   - Evidence: R7. 34 rule commits in 12 days; the Codex delegator stalled 6 h under implementor guards that were never tested for its role.
   - Batch rule and ADR changes to a weekly window. Any change to roster or guards ships with an `execpolicy`/role test, as picsee does and ADR-0141 now adds.
   - Before swapping delegator runtimes, run a dry "can I push, open a PR and land" check.
10. **Keep one live status view to stop re-derivation.**
    - Evidence: the release-status question asked 3 times, and delegator restarts re-reading rows, heartbeat and PRs.
    - Generate a `v036-status.md` (or a dashboard) from heartbeat, PRs and rows after each landing. Handoffs and user questions point at it instead of rebuilding the state.

## Key file paths

- Sequencing rows: `/Users/jack/Documents/mac-app/mdpro/docs/plans/20260912-frontend-backend-sequencing-order.md` (D319 :757, D255 :692, D290 :727, D305 :743, D294 :731, D299 :736, D291 :728, D322 :760, D323 :761)
- `/Users/jack/Documents/mac-app/mdpro/docs/audit/audit-log.md`
- `/Users/jack/Documents/mac-app/mdpro/docs/audit/escapes.md`
- `/Users/jack/Documents/mac-app/mdpro/docs/knowledge/20261027-acceptance-mechanism-vs-pstack.md`
- `/Users/jack/Documents/mac-app/mdpro/docs/reference/20261027-receipt-separation-broken-causes.md`
- `/Users/jack/.mdpro-redesign/herdr-spike/gpt-imple-1/D319-handoff.md`, `D322-handoff-stop1..5.md`
- `/Users/jack/.mdpro-redesign/herdr-spike/gpt-imple-2/D255-WI-3b-brief.md` (amendments at :416–645)
- `/Users/jack/.mdpro-redesign/herdr-spike/opus-imple-1/D319-F3-handoff.md`
- Transcripts:
  - `/Users/jack/.claude/projects/-Users-jack-Documents-mac-app-mdpro/fa3ecb2f-aedc-429d-95fc-e8841d1dd9b1.jsonl`
  - `/Users/jack/.claude/projects/-Users-jack-Documents-mac-app-mdpro/b865b1e2-b122-4dfc-970b-d4daf43aff0b.jsonl`
