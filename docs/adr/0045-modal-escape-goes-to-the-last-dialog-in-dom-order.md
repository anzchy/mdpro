# 0045. Modal Escape goes to the last open dialog in DOM order

**Status**: Proposed (2026-10-01). Becomes Accepted only after the D34 device
check: a physical Esc on both dialogs in a release build, with
`ui.dialog.escape` / `ui.dialog.cancel` lines in `~/.mdpro/mdpro.log`.

## Context

D34, found in the ADR-0042 WI-10 device run
([record](../test/20260930-adr0042-wi10-gui-acceptance.md)): a physical Esc
does not close the Unsaved-changes `ConfirmDialog`, and an injected Escape did
not reject `McpWriteConfirmDialog` (4 of 4). Both listened for Escape with a
card- or backdrop-level `onKeyDown` and relied on `autoFocus` to put focus
inside the card. Every jsdom test passed. The failure direction is safe:
nothing is discarded or written.

**The root cause is unconfirmed.** The leading hypothesis is that in WKWebView
focus is not inside the card, so the card never receives the key. jsdom cannot
reproduce WKWebView focus, and nothing has been run on device since the fix.
If the webview itself is not first responder when the dialog appears, no DOM
listener at any level receives the key, and this decision does not close D34.

Fixing it means moving the listener off the card, to a place that sees the key
wherever focus is. Once two dialogs can be open at once, one Escape needs one
owner. That happens when an MCP prompt is pending while the user closes a dirty
owning window (G5b). `src/App.tsx` renders `<ConfirmDialog` (L1049),
`<SettingsDialog` (L1058) and `<McpWriteConfirm />` (L1065), in that order.
All three use `.dialog-backdrop` at the same z-index, and `src/` has no
portals. So paint order is DOM order. Open order is not paint order: the MCP
prompt paints on top even when the Unsaved-changes dialog opened second.

## Decision

1. **One shared Escape stack** (`src/hooks/useDialogEscape.ts`). Dialogs
   register while open. The registry has a single `document` `keydown`
   listener in the capture phase, attached only while at least one dialog is
   registered.
2. **The topmost dialog is the registered container that is last in document
   order** (`compareDocumentPosition`). A tie goes to the later registration.
3. **A dismissal consumes the event**: `preventDefault` + `stopPropagation`,
   then one `ui.dialog.escape {dialog, outcome}` log line.
4. **IME Escape** (`isComposing`, keyCode 229) is ignored and not consumed.
   **A `repeat` Escape is consumed but dismisses nothing.**
5. **Members in D34**: `ConfirmDialog` (Escape = Cancel) and
   `McpWriteConfirmDialog` (Escape = Reject). No other Escape handler joins.
   That covers SettingsDialog, ReloadDialog, LinkInsertModal, TableInsertModal,
   the context menus, the shortcut recorder and the editor keymaps. Each was
   either not observed failing on device or is not a modal dialog.
6. **Yield to a later unregistered modal** (added 2026-10-01 by D34 WI-6,
   review finding C-1, user decision). `src/App.tsx` renders the BottomTabs
   and Sidebar `ConfirmDialog`s before RecoveryDialog, ReloadDialog,
   EncodingDialog and SettingsDialog, none of which is on the stack. When an
   open `[aria-modal="true"]` element that is not inside any registered
   container follows the topmost registered container in the document, the
   stack does nothing at all: no `preventDefault`, no `stopPropagation`, no
   dismissal, no log line. An unregistered modal earlier in the DOM, or one
   that contains the registered dialog, does not block it.
7. **An entry whose container is not attached** (`containerRef.current` is
   null) is never topmost. With only such entries, Escape is not consumed.
   A throwing `onEscape` logs `{dialog, outcome: "error"}` at level `error`,
   status `fail`, and the error propagates.

## Consequences

- Escape no longer depends on where focus is. The fix holds whatever focus
  WKWebView turns out to keep, provided the webview receives the key at all.
- **Cost (a):** the rule is only right while DOM order is paint order. A
  portaled or otherwise out-of-tree modal, such as one at the reserved z-index
  9999, can paint on top yet sit earlier in the DOM. The rule would then send
  Escape to a dialog underneath. The next such modal must revisit this ADR.
- **Cost (b):** while a stack dialog is open, no lower surface receives Escape.
  That covers Settings beneath the MCP prompt, the table and image context
  menus, the shortcut recorder and the editor keymaps. If an MCP prompt opens while a shortcut is
  being recorded, Esc rejects the prompt and recording continues.
- **Cost (c):** because of the repeat guard, holding Esc dismisses only one
  dialog. Closing a queue of MCP prompts takes one keypress each.
- **Cost (d):** the stack only outranks listeners that run after
  document-capture. A `window` capture-phase listener would still run before
  it and could consume Escape first. `src/` has none today, and nothing
  enforces that.
- **Cost (e):** Settings, Reload, Recovery and Encoding stay off the stack.
  As first written, a hidden `ConfirmDialog` took Escape while one of them,
  rendered later in the DOM, was open above it, and that dialog never saw the
  key. Decision 6 now yields to them instead, so the hidden dialog is no
  longer cancelled. What remains: the stack's yield does not deliver the key
  to them. Each still relies on its own focus-dependent handling (Settings'
  card `onKeyDown`, Reload's backdrop `onKeyDown`), which fires only while
  focus is inside it, the same mechanism that failed on device in D34.
  Encoding has no Escape close, and Recovery deliberately has none. So with
  focus on `<body>`, Escape over one of these dialogs does nothing at all.
  The yield also depends on each of them keeping `aria-modal="true"` on an
  element rendered only while open. A future unregistered modal without it is
  not detected and gets Cost (e) in its original form.
- Rules 32 and 33 still describe card-level Escape. Changing them needs user
  approval, and this ADR does not change them.

Related: D34 in
[`docs/plans/20260912-frontend-backend-sequencing-order.md`](../plans/20260912-frontend-backend-sequencing-order.md#d34),
[ADR-0042](0042-mcp-write-confirmation-is-an-in-window-queued-prompt.md)
(the MCP prompt), `.claude/tdd-guardian/plan-20261001-100508.md`.
