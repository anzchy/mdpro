# 0056. Recovery stays a forced choice, and the encoding dialog opens on Cancel

**Status**: Accepted (2026-10-07, user decision; WI-4.6b of plan P). Proposed 2026-10-07.

## Context

WI-4.6b gives `RecoveryDialog` and `EncodingDialog` the rule 32 dialog shell
(labels, Tab trap, focus return). Rule 32 says Esc and a backdrop click cancel and
that focus starts on the most-likely-edited control. Neither default fits these two
dialogs cleanly:

- `RecoveryDialog` (`src/components/common/RecoveryDialog.tsx:37-61`) offers only
  Recover (opens the draft) and Discard (deletes it). It has no close outcome.
  Rule 32 already exempts it from Esc, and `tests/focus-trap.test.ts:121-134` pins
  "no Escape", but rule 32 still says a backdrop click cancels.
- `EncodingDialog` appears only after UTF-8 failed: `detect_encoding`
  (`src-tauri/src/services/encoding.rs:1-15`) returns "UTF-8" whenever the bytes
  are valid UTF-8, and the dialog opens only on "unknown". Decoding is strict
  (`encoding.rs:17-33`), so a wrong choice corrupts nothing, but focus on the
  first button (UTF-8) means Enter repeats a decode that is certain to fail.
  (ASCII, a subset of UTF-8, is certain to fail too; that is a separate issue.)

A Codex review (2026-10-07) agreed on Recovery and argued for Cancel in Encoding.
A relayed answer from another session had said UTF-8; the user chose Cancel
directly, after the review.

## Decision

1. **RecoveryDialog stays a forced choice.** Esc and a backdrop click do nothing;
   a click on the card stops propagation as usual. Rule 32 gets a matching
   backdrop exemption. Initial focus is the first draft's Recover (Discard is the
   destructive action). The focus-trap test is kept as it is.
2. **EncodingDialog opens on Cancel.** Esc and a backdrop click also take Cancel.
   Choosing an encoding takes a Tab or a click.

## Consequences

- No draft is opened or deleted without an explicit choice, and the existing
  test keeps guarding that.
- Cost: a user who wants to look at the editor first cannot dismiss the recovery
  prompt; deferral ("decide later") is foreclosed until a flow defines how drafts
  reappear, which would need a new ADR.
- Cost: rule 32 carries one more dialog-specific exception, and two dialogs now
  break its "focus the likely control" rule.
- Cost: choosing UTF-8 takes one extra key press.
- ADR-0045's escape stack yields to these dialogs today; WI-4.6b must check the
  real keyboard behaviour, not only jsdom.
