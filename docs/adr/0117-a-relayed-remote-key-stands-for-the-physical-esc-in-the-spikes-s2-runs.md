# 0117. A relayed remote key stands for the physical Esc in the spike's S2 runs

## Status

Accepted, 2026-10-17. Decided by the user, who chose 「Accept (Recommended)」 when
mdpro-delegator put this text to them, after choosing 「Accept the remote key」 among three
options earlier the same day. Reviewed before acceptance by Codex `/cc-suite:review-plan` and the
Fable auditor in `plan` mode (rule 70); neither left a Critical or High on r5. Proposed
2026-10-17; ADR-0117 was reserved by mdpro-delegator; drafted by adr047-verify.

Supersedes, for the runs named in the Decision only, and only where "physical" bars a key a person
presses on another computer and remote-desktop software relays:
- [ADR-0100](0100-the-s2-negative-control-is-a-minimal-confirmdialog-patch.md) decision, the
  bullets "If a physical Esc closes the dialog on the control build, the control is void …" and
  "WI-005's human baseline is cut to the physical Esc presses …";
- [ADR-0113](0113-the-s2-control-takes-focus-out-of-the-dialog-with-one-backdrop-click.md)
  decision "What re-runs. The physical Esc is re-taken under this protocol on the control and head
  baselines and on both candidate A bundles (S2.1)", and its consequence "The physical class still
  applies to the Esc alone", as both apply to candidate B's S2.1 too.

Every other part of both records stands, the control patch and step 2a included.

## Context

**Why S2 asked for a physical key.** `progress.md` (2026-09-30, ADR-0042 WI-10) records a false
pass: D34's jsdom tests of the dialogs' Escape handler passed, and on the device a physical Esc
closed neither dialog. Along the way, harness-injected keys and `osascript` keystrokes gave two more
false signals, because neither takes a hardware key's path to the focused page. Its rule: keyboard
behaviour in a dialog is settled only by a physical keypress on the device. ADR-0047's S2 builds on
that rule, and ADR-0100 and ADR-0113 name the baseline Esc physical.

**What was taken instead.** Every person's Esc in the spike's S2 was made by the user on the
MacBook and relayed to the Mac mini by UU Remote. On the mini, the page's recorder saw each one
arrive as a `keydown` with `isTrusted:true`, with focus where the entry says. That is all the record
shows: it does not show how UU Remote injects the key, and `isTrusted` says the event came from the
browser engine, not from hardware. The spike record files these presses under its own class,
`remote key`, not `physical`:
- the S2 control under ADR-0113, 2026-10-16 18:07 to 18:10: baseline reverted stayed open, baseline
  head closed with `ui.dialog.escape` and `ui.dialog.cancel`;
- candidate A's S2.1, 2026-10-17 12:27 and 12:30: A reverted stayed open, A head closed;
- candidate B's S2.1, 2026-10-17 about 15:56 and 16:00: B reverted stayed open, B head closed.

The record admitted the class by an adr047-verify ruling (2026-10-16), and the user deferred the
upgrade to a local keyboard (「defer」). A deferral is not a decision. The pre-acceptance review
of ADR-0047 found that the accepted records still require a physical Esc (Codex, High; confirmed by
the Fable auditor), so either the evidence or the records had to change.

ADR-0113's Context calls the key that failed the first control (2026-10-16, before ADR-0113) "one
physical Esc". It was a `remote key` too: every Esc the user pressed for the spike went through UU
Remote, as the spike record's "Negative control (WI-005)" notes say ("The Esc presses came through
UU Remote", answered 「是的」 by the user). ADR-0113 is accepted and its body is not
edited; this paragraph is the correction. The misclassification does not change ADR-0113's
reasoning, which rests on where focus was, not on the key's class.

Comparison two's J5 step 3 on the production sample (`9940be9`, 2026-10-16 16:12) was a `remote
key` as well. ADR-0100 cut WI-005's baseline to the physical Esc presses, that one included. It is
not one of the runs this record admits (see the Decision).

**Candidate B's S2.1 was first recorded `physical`, wrongly.** The user had been sent to the mini
for the sitting, and dtrack inferred the class without asking. Asked afterwards by mdpro-delegator
where the presses were made, the user first answered 「在我的 MacBook，也就是本电脑上面构建，然后我来按。」, which
does not name the keyboard. Asked which keyboard, the user answered 「MacBook 上按（经 UU）」
(2026-10-17, relayed by mdpro-delegator). The class rests on that second answer. So no S2 run in
the spike, control or candidate, has a physical Esc.

## Options considered

1. **Accept the remote key for those runs** (chosen by the user). The record keeps the class name;
   these records stop barring it for the named runs.
2. **Redo them physically.** A few minutes at the mini: the control's two Esc presses and each
   candidate's two, on builds that still exist (the option was put as about 5 minutes, before B's
   S2.1 was found to be relayed too). It would have met the accepted records as
   written. The user chose against it and recorded no reason; the cost it would have avoided is
   the first bullet of the Consequences.
3. **Narrow the claim.** Leave the records as they are and state in ADR-0047 and the spike record
   that S2's control and both candidates' S2.1 rest on `remote key`, so S2 is not claimed against a physical
   baseline. It changes nothing on the device and leaves a stated gap in the selection. It also
   leaves S2 unverified against the physical baseline the unchanged records require, so ADR-0047's
   gate would not be met. The user chose against it and recorded no reason.

## Decision

- For the S2 control under ADR-0113 (2026-10-16), candidate A's S2.1 and candidate B's S2.1
  (2026-10-17), a `remote key` Esc stands where ADR-0100 and ADR-0113 require a physical one.
- The runs keep the class `remote key` in every record. They are not relabelled `physical`.
- Nothing else is admitted. Comparison two's J5 step 3 on the production sample is **not** admitted,
  so the production sample's physical Esc that ADR-0100 asks for is still unmet; the re-verification
  in ADR-0047 decision 5 takes it. `progress.md`'s rule stands. Driver input never counts as either
  class (ADR-0047 decision 8).
- Any later S2 run, the re-verification after selection included, needs a physical Esc, as ADR-0100
  and ADR-0113 say, unless a later accepted ADR changes that. A brief cannot waive it.

## Consequences

- **No physical Esc exists anywhere in this selection's evidence.** S2 rests on a weaker class,
  one that `progress.md`'s rule set aside after a real false pass. (That false pass came from jsdom,
  and the false signals beside it from harness-injected keys and from `osascript` keys sent to
  Warp; `progress.md` records no false pass from UU Remote.)
- **What S2 still separates.** On each of the three pairs the outcomes differed as the control patch
  predicts (reverted open, head closed), with the relayed key arriving at `BODY.` outside the card.
  So, for this relayed input and this focus, S2 still tells the element listener from the document
  listener, which is the difference the control patch makes.
- **What S2 loses.** There is no independent physical reference left to compare a driver's Esc
  with; the person's key and the driver's key are both injected. A difference between a hardware
  key and a relayed one would go unseen: its route to the window, the modifier state and event
  sequence the relay adds, and timing or activation effects that could hide a failure. On the
  reverted control the recorder logged six Escape entries and about 25 modifier entries for a brief
  that allowed one Esc (spike record, the S2 control's deviation note); the record does not say
  why. Focus at `BODY.` is a sample of each run, not a proof that focus behaves as it would under a
  hardware key. Input-method and timing behaviour under a hardware key are not established.
- **ADR-0047's selection cites this record** for S2: its spike result and the spike record's
  Selection table name `remote key` for the control, A's S2.1 and B's S2.1.
- **The re-verification's physical Esc matters more.** It is now the only chance to settle S2 with
  the class `progress.md` requires, and the only source of the production sample's physical Esc
  (S5). Its brief asks for a press on a keyboard attached to the mini (it has none attached today) and records where the key was
  pressed, rather than inferring it.
- **A precedent with limits.** It admits three named sets of runs, by the user's word. The next time
  a relayed key stands in for a physical one, it needs its own decision.
