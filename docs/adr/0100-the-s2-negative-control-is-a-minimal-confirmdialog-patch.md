# 0100. The S2 negative control is a minimal ConfirmDialog patch, not a revert of c39dfb1

## Status

Accepted, 2026-10-15. Decided by the user, who chose 「Minimal ConfirmDialog patch (Recommended)」
over 「Hand-resolved full revert」, and for the baseline sitting 「Only physical Esc, ~12 min
(Recommended)」 over 「Walk everything by hand, ~40 min」. The question was put by adr047-verify inside
the WI-005 prep task the user gave it. ADR-0100 was reserved by mdpro-delegator.

Partially superseded, 2026-10-16: decision 3's "J5 step 3 on both builds" as the baseline's human
step by [ADR-0113](0113-the-s2-control-takes-focus-out-of-the-dialog-with-one-backdrop-click.md).
The control on this patch did not hold with focus on Keep editing; the patch itself stands.

Supersedes one clause of [ADR-0047](0047-agents-verify-in-the-real-app-through-a-feature-gated-control-channel.md)
decision 4: S2's first build, "the spike branch with the `src/` part of `c39dfb1` (the D34 fix)
reverted". ADR-0047 is still Proposed; every other part of it stands.

## Context

ADR-0047's spike tests whether a driver's Esc behaves like a physical one (S2). It needs a negative
control: a build on which a physical Esc does **not** close `ConfirmDialog`. When the ADR was written
(2026-10-02), the four `src/` files of `c39dfb1` had not changed since that commit, so reverting
them was a clean way to bring D34 back. Plan WI-005 acceptance 1 said so explicitly, as measured
with `git log`.

By 2026-10-15 that was no longer true:
- `c39dfb1..9940be9` touches those files in 10 commits. `ConfirmDialog.tsx` changed 5 times (D53,
  D48, D38, D42 among them) and `useReturnFocusOnClose.ts` 4 times.
- `useDialogEscape.ts` is now also used by `ReloadDialog` and `EncodingDialog` (D140).
- `git revert c39dfb1` conflicts in 4 source and 6 test files.

Reverting the files to their pre-`c39dfb1` content would also undo D53, D48, D38, D42, D63 and D140.
A J5 difference on that build would then have more than one cause.

One risk applies to every option. `ConfirmDialog` puts initial focus on **Keep editing** by script
(D48, D53/D63), and that button is inside the card. The pre-D34 listener fired whenever focus was
inside the card. So even a faithful control may close on Esc, which voids S2 under ADR-0047 decision 4.

## Options considered

1. **Minimal patch on the baseline head, `ConfirmDialog` only** (chosen). Remove its
   `useDialogEscape` registration, and put back the pre-D34 element-level `onKeyDown` Escape on the
   backdrop, calling today's `handleCancel`. It is about 10 lines and changes one file. Every later
   fix stays, and the other dialogs keep the shared stack. On the patched tree the D34 reproducers
   fail as they did before the fix: `tests/confirm-dialog.test.tsx` CD-1 and CD-2 (Esc with focus on
   `<body>` and in an outside textbox), plus CD-4, CD-6 and CD-7; 16 of 21 pass.
2. **Revert `c39dfb1` and resolve the conflicts by hand.** This keeps ADR-0047's wording. It lost
   because it brings back unrelated old bugs, so the control would no longer isolate one change, and
   the hand resolution is itself an untested artifact.
3. **Build the control from `c39dfb1^`.** It lost because that tree predates WI-001 to WI-004, Tauri
   2.12.1 included, so it is not "the baseline head minus one change", and no driver can be built on
   it.

## Decision

- S2's negative-control build, in WI-005 and in the spike that follows, is the build under test with
  the patch `wi005-br-confirmdialog.patch` (option 1) applied. The patch is quoted whole in the spike
  record's "Builds" section. It is never committed and never pushed, and no gate runs on that build.
- The rest of ADR-0047 decision 4 is unchanged. If a physical Esc closes the dialog on the control
  build, the control is void and S2 is redesigned before the spike goes on.
- WI-005's human baseline is cut to the physical Esc presses: J5 step 3 on both builds, and J5 step 3 on
  the release sample. dtrack walks every other step of comparisons one and two by computer use, as
  WI-004 acceptance 3 was split on 2026-10-14.

## Consequences

- The control now tests one thing: where `ConfirmDialog` listens for Escape. A result on it says
  nothing about the other dialogs, which keep the shared stack on both builds.
- The patch is a hand-written artifact, not a commit. Its exact text lives in the spike record, and
  every spike bundle that needs a control must apply the same text. Drift between them would void
  the comparison.
- ADR-0047's sentence about `c39dfb1` no longer describes what is built. Anyone reading only
  ADR-0047 is sent here by its forward link.
- The control may still fail for the focus reason above. That outcome pauses the spike and is a
  result, not a defect.
- With the human part cut to the Esc presses, comparisons one and two rest on driver-free computer-use
  input for every other step. That class of input is the one WI-004 already accepted. It is not a
  person's hand, and the record names it as such.
