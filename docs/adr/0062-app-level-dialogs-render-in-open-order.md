# 0062. App-level dialogs render in open order

**Status**: Accepted (2026-10-08, decided by the user for D42; Codex was
consulted and recommended the same option). Amends
[ADR-0045](0045-modal-escape-goes-to-the-last-dialog-in-dom-order.md): its
rule, "Escape goes to the last open dialog in DOM order", is unchanged. What
changes is that DOM order now equals open order for the six App-level dialogs,
and ADR-0045's Context statement that the MCP prompt always paints on top no
longer holds. ADR-0045 is otherwise unchanged.
Partially superseded: Decision 1 for arriving MCP prompts, by
[ADR-0108](0108-an-mcp-prompt-waits-while-another-modal-is-open.md) (2026-10-15).
Partially superseded: Decision 1 for startup Recovery before its first
admission, and Decision 3 narrowed (Recovery's token is `null` while held), by
[ADR-0116](0116-the-startup-recovery-prompt-waits-while-another-modal-or-a-received-mcp-prompt-is-pending.md) (2026-10-17).

## Context

D42, found in the D34 device re-check (2026-10-02): `src/App.tsx` rendered
the App-level dialogs in a fixed source order: Recovery, Reload, Encoding,
the "Unsaved changes" `ConfirmDialog`, Settings, then `McpWriteConfirm`. All
use `.dialog-backdrop` at z-index 20 and none is portaled, so paint order is
DOM order. With Unsaved open (⌘W or closing the window), an external change
raised the Reload prompt *underneath* it, and Escape went to Unsaved. Nothing
was lost, but the prompt the user needed was hidden.

Forces:

- ADR-0045 routes Escape by DOM order, so any reorder also moves Escape.
- The MCP prompt (ADR-0042) arrives unasked, from another process. Fixed order
  kept it on top of everything, including Settings or Unsaved that the user
  opened afterwards on purpose.
- Six components must stay mounted while closed: Settings keeps state, and
  the `useMcpConfirm` subscription must exist before any prompt arrives.
- Options: **A**, all six dialogs follow open order; **B**, the other five
  follow open order and MCP stays pinned last.

## Decision

1. **All six App-level dialogs render in open order**, most recently opened
   last, so it paints on top and takes Escape. MCP is not pinned (option A).
2. **Pure model** in `src/utils/dialogOpenOrder.ts`: `nextDialogOpenOrder`
   carries `{id, token}` entries in open order; `dialogRenderOrder` lays out
   the open ids in open order, **then every closed slot in canonical order**.
   A dialog that is opening already renders after every open one, even in the
   render before the carried order catches up.
3. **Tokens**: Recovery, Reload, Encoding, Unsaved and Settings use the
   constant `"open"`, so a new reload message (modified → deleted) or a quit
   prompt taking over a close prompt does not re-raise the dialog. MCP uses
   the shown `requestId` (reported by `McpWriteConfirm`'s `onPromptChange`),
   so a queued replacement prompt re-raises.
4. **`src/components/AppDialogs.tsx`**, extracted from App.tsx, renders the six
   as keyed `Fragment` slots. All stay mounted; React moves keyed slots
   without remounting them. Handlers and state stay in App.tsx.
5. **Log**: one `ui.dialog.stack {order}` line per change of the open order
   while two or more dialogs are open. Ids only, never titles, paths or text.

## Consequences

- The dialog opened last is the one on screen and the one Escape reaches.
  Unsaved then Reload shows Reload on top (the D42 fix).
- **Cost:** an MCP prompt can be covered by a dialog opened after it
  (Settings, Unsaved, Reload) and time out unseen: 60 s, then `408
  CONFIRM_TIMEOUT` to the client and nothing written (ADR-0042). The failure
  is safe but user-visible. A non-modal "write pending" notice would address
  it; it is a separate improvement and is not done here.
- **Cost:** ADR-0045 Cost (e) now applies wherever an unregistered dialog
  becomes top. Escape over Reload or Settings still needs focus inside that
  dialog; with focus on `<body>`, Escape does nothing where it used to cancel
  Unsaved. Recovery and Encoding have no Escape at all. The stack yields to
  them (ADR-0045 decision 6) and does not deliver the key.
- **Cost:** a token re-raise (a queued MCP replacement) moves an open DOM
  node. React's commit restores focus on a moved element, but WKWebView's
  behaviour here can only be checked on a device, and that check is pending.
- **Cost:** the Sidebar and BottomTabs `ConfirmDialog`s stay outside this
  composition and keep their fixed position before it (ADR-0045 decision 6).
- ADR-0045 Cost (a) still binds: a portaled modal would break DOM order =
  paint order, and this ADR with it.
- **Rejected, B (pin MCP last):** it keeps the prompt visible, but an
  unasked prompt from another process would keep covering Settings or
  Unsaved after the user opened them on purpose, and would take their
  Escape. Under A, the hidden prompt times out safely (408, nothing written),
  so the cost of A is a retry for the client, not a lost or misdirected user
  action.

Related: D42 in
[`docs/plans/20260912-frontend-backend-sequencing-order.md`](../plans/20260912-frontend-backend-sequencing-order.md#d42),
[ADR-0042](0042-mcp-write-confirmation-is-an-in-window-queued-prompt.md),
`.claude/tdd-guardian/plan-20261008-122555.md`.
