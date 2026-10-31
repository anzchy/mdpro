# 0162. Before 0.3.6, boundary and Linux checks move ahead of the audit, receipts stay as they are, and process rules freeze

**Status**: Accepted (2026-10-31, the user: 「Accept r3 (Recommended)」). Proposed (2026-10-31, herdr-delegator; revised r2 the same day after plan review round 1: gpt-auditor
C0 H3 M4, fable-auditor C0 H3 M5 L4; revised r3 after round 2: gpt-auditor C0 H2 M2, fable-auditor C0 H0 M1 L8). From the user's answers to the rework assessment: receipts 「Keep as is」;
no-ADR measures 「Adopt all three (Recommended)」; process freeze 「Freeze until 0.3.6 (Recommended)」;
「Resume after ADR drafted」. The two-round cap (ADR-0143) was spent; r3 answers round 2's open findings, and the user ruled on acceptance. If accepted, this
partially supersedes, for its life (decision 6):
- [ADR-0144](0144-behaviour-acs-are-proved-in-the-real-app-before-landing.md)'s Windows ruling 「Stay in batches for
  now」, only to add one pre-audit Windows smoke operation per item (decision 2); the Windows card stays batched;
- rule 70 § Commits item 2's dispatch order (verifier and both audits dispatched together with the CI push): under
  decision 3, the audits and the verifier are dispatched after `ci-gate` is green on the head.

## Context
On 2026-10-31 the user asked 「反复开发核心原因是什么，让 fable 和 Codex 来评估，开发工作暂停」. gpt-auditor and
fable-auditor assessed the records blind (`~/.mdpro-redesign/herdr-spike/{gpt-auditor,opus-auditor}/rework-assessment.md`,
merged in `herdr-spike/delegator/rework-assessment-merged.md`). Both, from the audit log, escapes, gate exceptions and
working files of 2026-10-09 → 10-31, named four shared causes:
- behaviour whose truth lives on a platform or host (AppKit event order, Windows driver defaults, Linux CI, `cargo`/`rustfmt`
  on the pane PATH, load) is first exercised after the audit, so each discovery costs a round, a post-cap fix or an
  exception (D319, D326, D255-WI-3b, D336–D338 → D342, W036/W036b);
- timing and ownership are not modelled before the first RED, and the minimal fix under the cap introduces the next High
  (D290, D255-WI-3d, D305, ADR0150-WI1);
- the RED-receipt gate and its tooling (25 of 38 gate exceptions; seven tooling items);
- process contracts changing mid-item (95 ADRs and 101 rule commits in three weeks).
Both said to keep blind dual audit with counter-proofs, the CI gate with conditional-tests and the inventory, the landing
verifier, ADR-0144 device ACs, and the heavy lock.

## Options considered
1. **Receipts:** (a) keep as they are; (b) replay disposition: a byte change after RED whose base replay still fails→passes
   with unchanged assertions lands without a user waiver (gpt-auditor); (c) demote receipts from landing gate to audit
   evidence and freeze receipt tooling, #567 included (fable-auditor). The user chose (a): (b) and (c) each supersede parts of
   ADR-0145/0149 mid-release, and (c) reverses the jack-tdd-workflow route already accepted in ADR-0161.
2. **Checks ahead of the audit:** adopt all three, adopt only the PATH fix, or not now. Adopted in full. "Only the PATH fix"
   lost because it leaves the two late-discovery classes that cost the most rounds (D319/D342 boundary, D326/D255-3b CI);
   "not now" lost because 0.3.6's remaining items (W036b, D342, the macOS regression) are exactly the boundary kind.
3. **Process rules:** freeze until 0.3.6 or keep amending. Frozen. "Keep amending" lost because a rule changed mid-item
   was itself a measured cause (D326's gpt-only round one, G-ADR0146-1, D50 stopped on the rule-12 gate).

## Decision
1. **Receipts are unchanged.** ADR-0145, ADR-0149 and rule 10 stay as written, including ADR-0149 decision 6's interim
   per-landing receipt question and its own transition to ADR-0145 decision 4 once the entry ships. #566 and #567 continue.
2. **A boundary smoke runs before each audit request** (the first audit and every confirm) for an item that has a smoke owed.
   - **Owed when** any of these holds: a brief AC is tagged `device` (ADR-0144 decision 1's closed list); the item changes
     code that drives an OS, a host or a native driver from outside the app, by path `.agents/skills/*/scripts/**`,
     `scripts/{device,control}/**`, `scripts/redesign/device/**`, or by behaviour ADR-0121's "window and menu targeting".
     The brief records "Smoke: owed, <operation>" or "Smoke: none, because <reason>".
   - **What:** one representative operation of the changed behaviour through its real caller, with that caller's default
     arguments, on the target host, with the build or script identity pinned (SHA, hash, `releaseId`). It is not the
     ADR-0144 card and does not prove a `device` AC. The brief's WI-0 probe (brief template § 2b) still runs before the
     matrix on the seam; the smoke runs after implementation on the changed code.
   - **Who:** the implementor, when the operation is reachable without a desktop GUI from its pane (a CLI, a script, a
     local process). Otherwise the tester role of the day (rule 71), before the audit request: a macOS GUI smoke under the
     desktop lock and ADR-0134 decision 6; a Windows smoke over SSH under the remote-windows-device-test preflight. A Windows
     smoke may use native input (`menuclick`, `chord`, `filedialog` and the like) only on run-created fixture copies, inside a
     config snapshot and restore, under the clearances the last cleared batch held (W036's); a restart of the user's mdpro still
     needs the user's word for that run. When the operation needs a clearance not held (a language change, the user's
     documents), the brief says "Smoke: none, because <clearance>; card batched", and no D item is registered for it.
   - **Which head:** the smoke is run on the head each audit request names. A fix or rebased head carries the earlier PASS
     only when the tested behaviour and its caller are unchanged between the two heads (`git diff` of the changed paths is
     empty, or tree identity); otherwise it is run again before the confirm request.
   - **Outcomes:** PASS → the audit request cites it. A wrong effect → the item goes back to the implementor before the
     audit; this is not an audit round. NOT EXERCISED (driver or host cannot reach it) → the delegator registers the driver
     defect as a D item and the audit starts with the gap named in the request; the `device` AC stays owed under ADR-0144
     and nothing here waives it. A target host unavailable for more than one working day goes to the user.
3. **CI before the audit.** The implementor runs `node scripts/lint/conditional-tests.mjs` before the handoff (the inventory
   comparison has no valid local form on the mini, so it is left to CI). The delegator pushes the handoff head, waits for
   `ci-gate` on that SHA, and only then dispatches the verifier and both audit requests. A red head goes back to the
   implementor; it is not an audit round. A fix or rebased head gets a green `ci-gate` before its confirm request. Round
   one stays blind to PR comments as rule 71 says.
4. **Rust toolchain on PATH in every implementor pane.** The toolchain is
   `$HOME/.rustup/toolchains/stable-aarch64-apple-darwin/bin`. `reset-codex.sh` exports it for implementor panes and
   refuses to start the agent unless `command -v cargo` and `command -v rustfmt` resolve. A Claude implementor pane is
   started by the delegator's `herdr pane split … --env` line, which carries the same PATH; the first prompt to that pane
   has it run `command -v cargo` and `command -v rustfmt` before any other step and stop if either is missing. The two
   lines go in its first handoff. A missing toolchain is a stop, not a test failure.
5. **Process freeze until 0.3.6 ships.** Frozen: a new ADR, or an edit of rules 10, 12, 60, 70, 71,
   `docs/agents/audit-dimensions.md` or the landing and verifier tooling, that changes the number of audit rounds, the
   auditor set, the receipt contract or a landing-gate condition. Not frozen:
   - carrying out an ADR accepted before this one, including #566, ADR-0161's go-live (#567, tickets #569–#571) and ADR-0160's route;
   - an ADR already Proposed before this one (ADR-0159) and the I556 tickets ADR-0160 decision 2 keeps granted;
   - who holds a role (a model or pane change for capacity, by the user's word); the role set is what is frozen;
   - decisions 2–4 of this ADR;
   - a change an escape recorded in `docs/audit/escapes.md` forces, with the user's word.
   Lessons from a stumble go in the delegator guide's trials table.
6. **Life.** Decisions 2–5 end with the 0.3.6 release or the user's word. The delegator records the end as a dated line, quoting
   the user's word when that is the cause, in the sequencing doc's release-freeze paragraph. Decisions 2–4 are then kept or
   dropped by a new ADR. ADR-0160's feature freeze lifts separately, under its own decision 4.

## Consequences
- Each handoff and each fix round waits for one CI run before its audit (about 25 minutes), and a boundary item waits for
  one smoke; a GUI or Windows smoke also waits for the tester pane reset and the desktop lock, which serialise with
  ADR-0144 card runs. An unavailable host can hold an audit for up to a working day before the user is asked. In exchange,
  CI-only and default-argument failures stop arriving after the cap.
- Windows device time is spent earlier for one operation per item; the batched card run is unchanged.
- The receipt costs the assessment measured remain: receipt exceptions keep reaching the user at landing until the entry
  ships, the tooling items continue, and the `implementation-already-present` noise from the user's dirty files stays.
  This is accepted until 0.3.6.
- The freeze forecloses addressing, by rule, both assessments' top-ranked unaddressed cause (timing and ownership
  not modelled before the first RED, and fix-introduced Highs). Until 0.3.6 it is handled only as brief practice: the WI-0
  probe and the matrix's lifecycle row, which the delegator can ask for in a brief without a rule change.
- The freeze forecloses reacting to a new stumble with a rule; a recorded escape is still an exception path.
- Decisions 2–4 change the brief template, rule 71's gate list and `reset-codex.sh`; the script change lands by PR under
  ADR-0159's policy-file route if that is accepted, otherwise by the ordinary audited PR.
