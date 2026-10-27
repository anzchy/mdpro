# 0144. Behaviour ACs are proved in the real app before landing, against acceptance cards kept in the repo

## Status

**Accepted, 2026-10-27.** Decided by the user: 「Accept (Recommended)」, after gpt-auditor's scoped round 3 closed the
last three Highs (C0 H0; `ADR-0144-r3.md`). Recorded by herdr-delegator.

Proposed 2026-10-27, by herdr-delegator (Claude route), for issue #542 items 1, 3 and 7. The user adopted the
recommendations: 「建议1-7 均采纳，创建一个GitHub issue，然后开始做相关的改进」. Revised the same day after plan review
round 1 (gpt-auditor C0 H5 M3, opus-auditor C0 H2 M8 L1; reports `herdr-spike/{gpt-auditor,opus-auditor}/ADR-0144-r1.md`).
Round 2 (gpt-auditor C0 H3 M1, opus-auditor C0 H0 M3; `ADR-0144-r2.md`) left three gpt Highs partial: the AC
binding, the lock on a blocked prompt, and script links. With the review cap reached, the closing edits below were made
without a third round, and the user decides under ADR-0143 decision 3.

This ADR amends, and names each clause it amends:
- **rule 70 Commits item 2.** It adds a fourth landing condition and its checker. Base:
  [ADR-0085](0085-a-branch-is-audited-before-it-is-fast-forwarded-onto-master.md) and
  [ADR-0095](0095-pull-request-ci-is-a-landing-gate.md).
- **rule 70 § Device-check batches.** A batch no longer makes the first check of an item's own `device` ACs.
- **rule 71 § Briefs and self-acceptance.** It adds the `unit` / `device` tag and card references.
- **The release checkpoint.** It adds the ledger-linked card run (decision 7).

It does **not** change who runs GUI tests: rule 70 § The Mac mini's "Only real-device-tester runs GUI tests", rule 71's
2026-10-25 routing to `gpt-auditor`, and [ADR-0134](0134-the-herdr-roster-moves-to-the-mac-mini-isolated-from-picsee.md)
decision 6 (the desktop lock, and the user's per-run word that picsee runs no GUI) all stand. It does not change the
audit ([ADR-0121](0121-audit-effort-follows-risk-pre-existing-findings-do-not-block-and-auditors-are-measured.md),
[ADR-0143](0143-every-audit-runs-gpt-auditor-and-opus-auditor-together-capped-at-two-rounds.md)).

## Context

The forces, as measured on 2026-10-27 ([assessment](../knowledge/20261027-acceptance-mechanism-vs-pstack.md)):

- **Real-app behaviour is first observed after landing.** Before landing, an item is proved only by unit tests under
  jsdom and by two auditors who read the diff. A device batch runs after the item is on `master`.
- **Device failures arrive after landing.**
  - D319 passed three audit rounds, landed as `9b9cd404`, and failed 4/4 in B8: AppKit ends menu tracking before ⌘\`
    switches windows. That is a runtime fact that neither tests nor a diff review could see.
  - It then cost Fix 3, PR #539, another audit, and B8b/B8c.
  - Earlier: D261 → D319 in B5c, and D299's protected move → D315 in B1.
- **The cards are not checked.**
  - The 62 acceptance cards live in `~/.mdpro-redesign/device/v036-owed-work/cards/`. The delegator writes them and
    nobody reviews them.
  - Eight card or brief errors are on record. Examples: B5 asked Switch Documents to list tabs, which the menu plan
    never specified (`docs/test/20261024-b5-menu-bar-find-replace-device-check.md:16`); B3's `chmod 444` cannot make
    the atomic write fail.
- **Batches are re-run.** B5 ran three times, B6 twice, B8 three times and B9 twice. The causes were Computer Use
  limits, running out of steps, and wrong cards.
- **The ledger cannot check itself.** Its 怎么确认 column is prose. `ledger:check` checks paths, states and declared
  names, not whether a row's check still holds.
- **There is a tool for this, half-built.** pstack's `prove-it-works` asks for verification against the real
  artefact before "done". mdpro's ADR-0047 control channel was built for this, but it is still `Partial`.
- **One desktop.** The Mac mini has one desktop, shared with picsee, and GUI runs already serialise on its lock.

## Options considered

1. **Keep post-landing batches only** (today). Lost: behaviour defects reach `master` and then cost a full
   fix-and-audit cycle.
2. **A device run for every item before landing.** Lost: CSS, docs, tooling and pure-logic items gain nothing, and
   every landing would queue behind the one desktop.
3. **Implementors run their own GUI checks.** Lost for now: it contradicts the tester-only clause and the user's
   2026-10-25 routing, and it puts two implementors and the batch tester on one desktop lock. It can be reopened once
   the control channel (WI-011) runs without a desktop GUI.
4. **Tag each AC `unit` or `device`; the tester role proves `device` ACs on the handoff SHA during audit round one;
   cards live in the repo and rank below the plan; ledger rows link to checked cards.** Chosen.
5. **More audit instead** (a third model or a third round). Lost: the escapes above are runtime facts that a reader of
   the diff cannot see.

## Decision

1. **Tags.**
   - The delegator tags every brief AC `unit` or `device`. An AC is `device` when its proof needs an artefact jsdom
     does not produce. The closed list:
     - a native menu or window order;
     - focus moving between windows or into native dialogs;
     - a real key event at the OS level;
     - a file-system event;
     - a native dialog;
     - the updater or a bundle;
     - a pixel value (contrast, rendering).
   - Everything else is `unit`. A CSS-only change keeps rule 10's visual QA and is `device` only for a pixel value.
   - The brief names the list entry for each `device` tag.
   - An auditor may raise `unit` to `device` in round one only. The user may raise or lower any tag.
2. **Cards.**
   - A `device` AC cites one or more cards at `docs/test/cards/<ID>.md`. They sit beside the device records that cite
     them; `tests/manual-fixtures/` keeps the documents a run opens.
   - **Schema:**
     - the controlling AC, quoted with its anchor (plan section or D row);
     - setup;
     - numbered steps, each with a class: `cli`, `computer-use` or `human`;
     - the failure condition;
     - the proof: a log line, plus an effect (document state, file bytes, or a screenshot for pixel ACs). A screenshot
       never proves a negative or an ordering alone.
   - **Precedence:** plan or D-row AC, then the brief, then the card.
     - A card may only narrow how something is checked. It may not add product behaviour.
     - A card that disagrees with its controlling AC is wrong. The run stops, records NOT EXERCISED with "card
       conflict", and the card is corrected under review.
     - The plan or D row is amended first if the behaviour is meant to change.
   - **Review:** a card is reviewed against its controlling plan or D row, not against the brief alone. That happens
     in the plan review, or for a D item in the round-one audit request. A migrated legacy card, or a card first
     needed by a batch, goes to gpt-auditor in a card-review request before the run. `scripts/ledger/` validates the
     schema (decision 7).
   - **The quoted AC must still match.** `ledger:check` and the landing verifier compare the card's quoted AC text
     with the anchor's current text. A mismatch fails the check and voids any PASS taken with that card.
3. **Who runs it, and when.**
   - The device run of the handoff SHA happens in round one, after gpt-auditor's round-one code report is written.
     The device pane is a separate reset of the same name, and herdr names are unique among live agents, so the two
     are serialised.
   - It is run by the tester role of the day (`gpt-auditor` in a device pane, rule 71), under rule 70 § The Mac mini
     and ADR-0134 decision 6. The delegator schedules it, takes the desktop lock and gets the user's per-run picsee
     word.
   - A FAIL is a High in the round-one merged verdict, so its fix lands inside the ADR-0143 two-round cap. The round-two
     run is scheduled with the confirm.
   - Queue order on the lock: a release-gate run, then a pre-landing run in the user's priority order, then a routine
     batch.
   - A run blocked at a Computer Use or `human` prompt keeps the lock while it waits (ADR-0134 decision 6). If it
     cannot continue, the tester quits mdpro and closes every window it opened, then releases the lock, and reports
     NOT EXERCISED with the step.
   - The implementor provides the verify-build command and stays on the item; the slot is held until landing.
4. **Evidence.**
   - The tester's report goes to `~/.mdpro-redesign/device/<ID>-pre-<sha7>-report.md` and is committed with the
     landing record.
   - The pid is the one in the `app.ready` line of the same run's log, and the only mdpro process from that bundle
     path.
   - It names the card ids, the blob hash of each card file, the controlling AC text hashes, `app.ready.releaseId`,
     the bundle path and pid, and
     per step the verdict, the log lines and the effect.
5. **Landing identity, the fourth landing condition (rule 70 item 2).**
   - Every `device` AC has PASS evidence whose identity matches the landing SHA. The identity is:
     - the whole tree minus `docs/` other than `docs/test/cards/`, minus `tests/` other than `tests/manual-fixtures/`,
       and minus `.claude/`, `.agents/`, `.codex/` and `CHANGELOG.md`;
     - plus the blob hash of each card cited;
     - plus the text hash of each card's controlling AC (plan section or D row), taken at the run.
   - The `releaseId` SHA must resolve to a commit with that identity.
   - Any change inside the identity needs a new run. That includes a card edit, a patch, the lockfile, `package.json`,
     a config file, `index.html` or `public/`.
   - The landing verifier checks this and reports it as a fourth result line.
   - Only the user waives a missing PASS, as an audit-log gate exception. NOT EXERCISED is not PASS.
6. **Batches** stay for release regression and cross-item interaction, and run cards by id. They no longer carry the
   first check of an item's own `device` ACs.
7. **Ledger.**
   - A row's 怎么确认 cell links its proofs as `card:<ID>` or `script:<path>`.
   - `ledger:check` validates each link:
     - the card exists and passes the decision-2 schema, and its quoted anchor resolves;
     - the script exists and is listed in `docs/test/cards/scripts.json` with its command and expected decisive output.
   - Existence is a lint. Whether a link covers the row is decided at review: for a card under decision 2; for a
     script, by gpt-auditor in the request that adds it, checking that its decisive output asserts the row's
     behaviour. An unreviewed link counts as no proof.
   - At each release checkpoint the delegator runs every link of every row whose files changed since the last release
     tag, not only rows whose text changed. It records per row PASS, FAIL or NOT EXERCISED in that release's device
     record. Unlinked `Shipped` and `Partial` rows are listed as "no proof".
8. **The legacy cards.**
   - From acceptance, no off-repo card is used for any run.
   - A card needed by a batch, a release run or a pre-landing run is migrated and reviewed first.
   - Ledger rows gain links as their cards migrate. The 19 rows still at 真机未验 are migrated in the next batch of
     their area.
   - **Cutoff:** at the first release after 0.3.6, an unlinked `Shipped` or `Partial` row counts as a release-gate
     finding.
9. **Effective date.** Briefs written after acceptance. Items already in flight keep "device pending", except
   ADR-0047 WI-010, which pilots decisions 3–5.

## Consequences

- **Gained.**
  - A behaviour failure is seen while the branch is open, before the fix rounds are spent.
  - Cards become reviewed artefacts with one source and a precedence rule.
  - Ledger rows get a check that can be re-run.
  - The escape log (issue #542 item 5) measures whether this works.
- **Costs.**
  - Every `device` item waits for the one desktop, and, until picsee honours the lock, for the user's per-run word.
    The user enters the inner loop.
  - Each fix that touches the identity re-queues a run, and so does each rebase over another landing, because the
    identity covers all of `src` and `src-tauri`. With two or three items in flight, most landings will force a
    re-run for the item behind them.
  - A re-run that FAILs or is NOT EXERCISED after review round two goes to the user (ADR-0143 decision 3).
  - ADR-0047 decision 8 keeps physical keys `human`, so some cards need the user's hands before landing.
  - NOT EXERCISED waivers will be frequent until WI-010 and WI-011 cover keys, timing and state reads.
  - The verify bundle's identity differs from the shipped bundle's, so pre-landing evidence is not on the shipped
    artefact. The release run remains the check for that.
  - Card review lengthens plan reviews and D-item audit requests.
  - The release checkpoint gets longer.
  - The tester role is held by the same pane name as the code auditor. The two work in separate fresh panes and
    separate reports, so the device verdict does not see the code verdict, but one model family does both.
- **Foreclosed.**
  - A `device` AC landing with "device pending" without a recorded waiver.
  - An off-repo card used for a run.

## The user's answers (2026-10-27)

1. **The picsee word:** 「Negotiate the lock (Recommended)」. The delegator asks picsee-delegator to honour
   `desktop-gui.lock`. Until picsee does, the per-run word stays.
2. **Cutoff:** 「First release after 0.3.6 (Recommended)」, as decision 8 says.
3. **Windows:** 「Stay in batches for now (Recommended)」. Windows `device` ACs keep being checked in batches until the
   B7 driver covers them. Decisions 3–5 apply to macOS.
4. **The review cap:** 「One scoped round 3 (Recommended)」. gpt-auditor confirms the three round-2 partial Highs on
   the closing edits only.
