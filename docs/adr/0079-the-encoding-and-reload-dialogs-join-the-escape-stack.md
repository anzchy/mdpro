# 0079. The encoding and reload dialogs join the Escape stack

**Status**: Accepted (2026-10-11, user decision, relayed by mdpro-delegator:
「批准 ADR-0079，D140 按此提交 (Recommended)」). Proposed 2026-10-11 by mdpro-a3
for D140; number reserved by the delegator. Partially supersedes
[ADR-0045](0045-modal-escape-goes-to-the-last-dialog-in-dom-order.md): only
decision 5's membership clause as it applies to `EncodingDialog` and
`ReloadDialog`, and the matching part of its cost (e). Every other part of
ADR-0045 stands. That includes the shared stack, DOM-order topmost, the IME
and repeat rules, decision 6's yield, and `SettingsDialog` and
`RecoveryDialog` staying off the stack.

## Context

ADR-0045 put one shared Escape stack (`src/hooks/useDialogEscape.ts`) in
front of the modal dialogs, because a focus-dependent Escape handler failed on
device. In D34, a physical Esc did not close the unsaved-changes
`ConfirmDialog`. Decision 5 limited the members to `ConfirmDialog` and
`McpWriteConfirmDialog`, on the grounds that the other dialogs "were not
observed failing on device". Cost (e) recorded what that left behind.
Reload and Encoding keep their own backdrop `onKeyDown`, which fires only
while focus is inside the dialog, so with focus on `<body>` Escape does
nothing.

The 2026-10-11 encoding device batch (D140, record
`docs/test/20261011-encoding-819fa2c-device-check.md` E4) reported that Esc
did not close the encoding dialog. Investigation showed two separate things:

- **The E4 symptom itself came from the harness.** The tester's routes
  (`kc.sh` → `osascript key code 53`, and computer-use `key Escape`) never
  deliver an Escape keydown to mdpro. The first failed 4 of 4 on the
  registered `ConfirmDialog` in the D42 run. ADR-0048 and the gui-acceptance
  skill's "Known blocker: Escape" record the second. Nothing in `src/`
  intercepts Escape while these dialogs are open.
- **The cost (e) defect is real.** WebKit on macOS does not focus a button
  on click. Clicking the dialog's text or a button therefore leaves focus on
  `<body>`, and Esc then does nothing on Encoding or Reload. That is the D34
  failure mode for exactly the two dialogs a user meets in the middle of
  opening and reloading files. D42 case 4.13 had pinned it as a known cost.

## Options considered

- **Keep the backdrop `onKeyDown` and accept cost (e) (status quo).**
  Lost because the cost is not hypothetical for these two dialogs. A user
  meets them in the middle of opening or reloading a file, and clicking the
  dialog's text, the natural thing to do before reading it, puts focus on
  `<body>` on macOS. Esc then silently does nothing. ADR-0045 accepted the
  cost only because these dialogs "were not observed failing". D42 case 4.13
  and the D140 investigation now show the path exists.
- **A second global capture listener just for these two dialogs, outside
  the stack.** Lost because it brings back the problem ADR-0045 solved. Two
  document-level Escape owners would both have to agree on which dialog is
  topmost. The stack's DOM-order rule, decision 6's yield, the IME and
  repeat guards and the one `ui.dialog.escape` line per press would all have
  to be duplicated or would drift apart.
- **Focus the card on any click inside the dialog, so the existing handler
  always hears the key.** Lost because it fixes only the click case.
  Programmatic focus moves, a focus that leaves for another window and comes
  back, and any future content that takes focus would each re-open the hole.
  It would also have to fight WebKit's no-focus-on-button-click behaviour on
  every element.

## Decision

1. `EncodingDialog` (`dialog: "encoding"`, outcome `cancel`) and
   `ReloadDialog` (`dialog: "reload"`, outcome `ignore`) register on the
   Escape stack the way `ConfirmDialog` does, with the backdrop as the
   container. Escape calls the same handler as the Cancel / Ignore button.
   For the encoding dialog that is the cancel path that aborts a pending
   retry (D121).
2. Their backdrop Escape handlers are removed. Backdrop click, the D121 Tab
   trap and the initial focus stay as they are.
3. Decision 6's yield is unchanged. The last-opened registered dialog is
   topmost by DOM order, and `SettingsDialog` and `RecoveryDialog`, which are
   still unregistered, still get the yield.
4. Every Esc check on device is a physical-key user step. A synthetic route
   proves nothing either way.

## Consequences

- With focus anywhere, Escape closes the encoding and reload dialogs. Each
  close logs `ui.dialog.escape {dialog, outcome}` plus `ui.dialog.cancel`,
  the same pair as `ConfirmDialog`.
- **Cost:** two more members raise the stakes on ADR-0045's cost (a). The
  topmost rule is right only while DOM order is paint order, and a future
  modal rendered out of open order would now misroute Escape for these two
  dialogs as well.
- **Cost:** while either dialog is open, no lower surface receives Escape
  (ADR-0045 cost (b), now extended to them).
- **Cost:** `SettingsDialog` and `RecoveryDialog` keep cost (e). Settings
  still closes on Escape only while focus is inside it.
- **From now on every device Esc check is a physical-key user step**
  (decision 4, adopted with the E4 reading). Briefs plan it as a step the user
  performs. `kc.sh 53` and computer-use `key Escape` are recorded as "not
  exercised", never as pass or fail.
- Only jsdom has verified the focus-on-`<body>` path. jsdom cannot reproduce
  the E4 symptom, because that was the harness. The device check needs a
  physical Esc with the ABC input source, with focus inside the card and
  again after clicking the dialog text.
