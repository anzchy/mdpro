# 0042. MCP write confirmation is an in-window, queued, bounded prompt

**Status**: Accepted (2026-09-30; proposed 2026-09-28). Amends the logging clause of [ADR-0040](0040-the-mcp-server-switch-takes-effect-live.md) decision 6; ADR-0040 is otherwise unchanged.

## Context

The ADR-0040 device acceptance run (2026-09-28, debug build `d211550`,
recorded in D25) found three defects outside that ADR's scope:

- **The write confirmation locks the whole app.** When no mdpro window is
  focused, `update_document`, `insert_content` and `dispatch_table_action`
  (`src-tauri/src/services/http_server.rs`) show `rfd::MessageDialog`, an
  app-modal native alert, and await it with no timeout. While it is up, ⌘,
  cannot open Settings, so MCP cannot be turned off. A Quit Apple Event is
  rejected by AppKit (`User canceled (-128)`); it is dropped, not queued. The
  MCP client waits until someone answers, and the prompt appears precisely
  when the user is not looking at mdpro.
- **The approval rule is "any window focused".** A write to a document in
  window B skips confirmation if window A is focused.
- **A corrupt `config.json` silences the log.** `logger.rs` deliberately
  fails closed (`FAIL_CLOSED_SETTINGS`): the user's logging choice is unknown,
  and fail-open would re-enable logging for a user who turned it off. So
  ADR-0040 decision 6's "the log records why" does not hold for a corrupt or
  unreadable config.

Codex reviewed the options (2026-09-28). A timeout on the native alert
(option B) was rejected: `rfd` cannot be shown to dismiss its alert, and the
app-wide lock and dropped quits remain. A window-modal `NSAlert` sheet
(option C) needs the same timeout and cancellation plumbing plus
macOS-specific code. An `os_log` diagnostic for the logging gap was rejected
as a logging exception made while the user's choice is unknown.

## Decision

1. **Confirmation is an in-app prompt in the window that owns the
   document.** The backend emits a confirmation request carrying a request
   ID; the owning window shows a rule-32 dialog; a reply command answers by
   request ID. Duplicate, late or unknown replies are ignored. The app is
   never app-modal because of MCP.
2. **The approval rule is the owning window.** A write applies without a
   prompt only if the window holding the target document is focused.
3. **Requests queue FIFO per window.** One prompt is shown at a time; an
   approval covers exactly one operation.
4. **Every pending confirmation is bounded.** It is never applied unless
   approved, and it ends in one of three client-visible outcomes: the user
   refuses → `403 USER_REJECTED`; 60 s pass from arrival → `408
   CONFIRM_TIMEOUT`; the server stops, the app exits or the owning window
   closes → `503 CONFIRM_CANCELLED`. A client can tell a refusal from a
   timeout from a withdrawal. The app requests attention (Dock bounce) when
   a prompt arrives unfocused.
5. **The same flow covers all three write paths** — replace, insert, and
   table actions.
6. **Logging stays fail-closed on an unreadable config.** ADR-0040
   decision 6's "the log records why" holds only when logging settings can be
   read. The user-facing reason is the Settings status note.
7. `mcp.autoApproveEdits` remains unconsumed (D25); its effect on this flow
   is decided when it is wired, not here.

## Consequences

- MCP can always be turned off and the app can always quit, whatever a
  client is waiting on; no MCP request waits longer than the timeout.
- **Cost:** a new event and reply command (an IPC contract change), a
  pending-request table with its own lifecycle, a dialog component, and
  tests for timeout, late/duplicate replies, stop/exit/window-close
  cancellation and concurrency. More code than the one-line native alert.
- **Cost:** a user away for more than 60 s returns to a rejected write; the
  client must re-send. Nothing is replayed automatically.
- **Cost:** a write aimed at a document in an unfocused window now prompts
  where it used to apply silently when some other window was focused.
- **Cost:** a launch with a corrupt config leaves no file-log trace;
  diagnosing it after the fact relies on the user reporting the Settings
  note.
- Clients relying on the old behaviour see two new error codes
  (`408 CONFIRM_TIMEOUT`, `503 CONFIRM_CANCELLED`).

**Device acceptance (2026-09-30).** G1–G8 passed on a debug bundle of
`6df4896` ([record](../test/20260930-adr0042-wi10-gui-acceptance.md)). Not
verified on device: table-action confirmation (table actions are HTTP-only,
covered by source-level tests) and the Dock bounce (the Dock was not
observable to the harness). Escape does not reject the prompt on device; the
same defect predates this ADR and affects the older Unsaved-changes dialog
(D34). The Reject button and the 60 s bound still resolve it.

Related: ADR-0040 (live switch; decision 6 amended here), D25 in
`docs/plans/20260912-frontend-backend-sequencing-order.md`,
`.claude/rules/32-component-patterns.md` (dialog pattern).
