# 0108. An MCP confirmation that arrives while another modal is open waits until it closes

**Status**: Accepted (2026-10-15). Decided by the user, relayed by
mdpro-delegator: after a Codex consult the delegator recommended option (a),
and the user answered 「OK」. Drafted by mdpro-a6 for D240; the delegator
reserved the number and set the terms. Partially supersedes
[ADR-0062](0062-app-level-dialogs-render-in-open-order.md), Decision 1, for
MCP prompts that arrive while another modal is open. ADR-0062's other
decisions stand, and a prompt already on screen is still covered by a dialog
opened after it, as ADR-0062 says. Compatible with
[ADR-0042](0042-mcp-write-confirmation-is-an-in-window-queued-prompt.md):
the queue stays FIFO, and the deadline stays Rust's 60 s, then 408.

## Context

- **Under ADR-0062 a prompt that arrives last renders last.** It paints over
  whatever is open, moves focus to Reject, and takes Escape. With Insert Link
  open, the Enter typed to insert the URL rejected an unrelated write, and the
  Escape meant for Insert Link rejected it through the shared Escape stack
  (D240). The same held for Settings, Unsaved changes and Recovery.
- **Rust owns the deadline.** `broker.rs` sets it at arrival + 60 s and answers
  the client `408 CONFIRM_TIMEOUT` when it passes; `queue.rs` guarantees one
  write per request. The frontend can hide a prompt but cannot extend it.
- **⌘K opened Insert Link over an open modal** (D235-WI-2). D235 refused
  Insert Table and Preferences while a modal is open, but both editors' own
  keymaps open Insert Link and never reached that guard.
- Consult record: `~/.mdpro-redesign/prep/codex-consult-d240-mcp-confirm-over-modal.md`
  (line numbers from `47794a32`).

## Options considered

- **(a) Queue: while any modal is open, an arriving prompt renders nothing,
  takes no focus and registers no Escape; the oldest live one shows when the
  modal closes.** Chosen. The open dialog keeps its edits, its focus and its
  Escape.
- **(b) Close or replace the open dialog.** Lost: it throws away a half-typed
  URL or Settings' unsaved shortcut state (`KeyboardShortcutsSettings.tsx:98`),
  and every dialog would need a cancellation and focus-cleanup path.
- **(c) Show the prompt on top and suspend what is underneath** (inert,
  aria-hidden). Lost: it still interrupts typing, and inert is not enough.
  Settings' window-level shortcut recorder (`KeyboardShortcutsSettings.tsx:136`)
  and the delayed refocus in Link (`LinkInsertModal.tsx:50`) and Settings
  (`SettingsDialog.tsx:95`) reach past it. It has the widest verification
  surface of the four.
- **(d) Leave it.** Lost: the focus theft stays, and so do the accidental
  rejects from Enter and Escape.

## Decision

1. **`useMcpConfirm` holds an arriving prompt while a modal is open.** "A
   modal is open" means an `[aria-modal="true"]` element other than the MCP
   dialog is in the document (`isModalOpen` in
   `src/utils/modalTabActionGuard.ts`). While it holds, the hook publishes no
   prompt, so no dialog mounts, nothing takes focus and no Escape registers.
   It logs `ui.mcp_confirm.held` once per request (ids and operation only).
2. **A MutationObserver on `document.body` re-publishes** when a modal closes
   and the queue is non-empty; the oldest request still live then shows, with
   Reject focused.
3. **The deadline is the arrival time plus `expiresInMs`**, never restarted. A
   request past it is dropped without a reply (`ui.mcp_confirm.expired`), so
   the client gets Rust's 408, never a reject or an approve. A
   `mcp:confirm_resolved` for a held request removes it as before.
4. **⌘K is refused while a modal is open**, in both editors and with Recovery
   included, through the D235 guard: `ui.dialog.open` `cancel`, action
   `format.hyperlink`.
5. **Every modal carries `aria-modal="true"`.** `tests/d240-modal-aria-contract.test.ts`
   checks that each `role="dialog"` tag in `src/` has it and that each
   `.dialog-backdrop` is matched by one.

## Consequences

- **A prompt can expire unseen behind a modal.** A user who stays in Settings
  for over a minute never sees the request, and the client gets a 408 with
  nothing written. That is the same safe failure ADR-0062 accepted, now also
  reachable by a prompt that would have shown under ADR-0062.
- **The hold depends on `aria-modal="true"`.** A future modal without it would
  not hold the queue, and the prompt would paint over it again. The contract
  test catches a `role="dialog"` or `.dialog-backdrop` without it, not a modal
  built some other way.
- **The deadline check is local to the frontend clock.** It mirrors Rust's
  deadline from the payload's `expiresInMs`; Rust's timer stays the authority,
  and a skew of a few milliseconds only changes whether a request about to
  expire is shown for that moment.
- **Prompts stay held while dialogs stack.** If a second modal opens before the
  first closes, the prompt waits for the last one, which can take longer.
- **No notice that a write is waiting.** The non-modal "write pending" notice
  ADR-0062 named is still not built.
- **Tests that pinned "MCP over the open dialog" were rewritten** to assert the
  hold (d42 open-order suite and its slow sibling, the Escape-stack suite).
  `src/utils/dialogOpenOrder.ts` and its oracle are unchanged.
