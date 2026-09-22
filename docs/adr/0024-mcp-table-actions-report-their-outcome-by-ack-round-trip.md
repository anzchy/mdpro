# 0024. MCP table actions report their outcome by an acknowledgement round-trip

## Status

**Proposed** (2026-09-22). Closes the residual recorded on the **D9** row of
`docs/plans/20260912-frontend-backend-sequencing-order.md`. Does not reopen
[ADR-0009](./0009-narrow-source-table-detection-to-gfm.md) or
[ADR-0013](./0013-under-detection-shifts-table-ordinals.md).

## Context

`dispatch_table_action` (`src-tauri/src/services/http_server.rs:787-875`)
serves all six `/api/v1/*` table routes. It checks that the document exists,
shows the write-confirmation dialog if no window is focused, emits
`mcp:table_action`, and returns `202 {"scheduled": true}` at `:874`. That
response goes out **before any table has been parsed**. Rust never sees a
`TableModel`. The frontend (`processTableActionEvent`, `src/hooks/useMcpEvents.ts`)
fails in five ways, and none of them reaches the caller:

| Frontend outcome | Only trace |
|---|---|
| `tableIndex` past the last table, row/col out of range, `\n` in cell, unknown action | `mcp.table.<action>` fail, `reason: "invalid payload"` (`applyMcpTableAction` returns `null` for all of these) |
| Write guard refuses the model (`TableWriteRefusalReason`) | `ui.table.write_refused` (`tableWriteGuard.ts:174`), then the same "invalid payload" line |
| Document not in this window's store | `mcp.table.<action>` fail, `reason: "not found"` |
| Milkdown `replaceAll` throws | `mcp.table.<action>` fail. The documentStore has **already** been updated, so the change is partly applied |
| Webview never processes the event | nothing |

The forces as they stand today:

- **"Confirm with `read_document`" is unreliable.** `docs/guide/tables.md` and
  the comment at `http_server.rs:765` tell clients to re-read. Table actions do
  not update the shadow store optimistically (`write_document` does). The new
  content only arrives after `useMcpSync`'s 300 ms debounce. A re-read inside
  that window cannot tell "refused" from "not yet synced".
- **The confirmation dialog runs in Rust, before the emit.** An
  acknowledgement timer would start after the dialog closes, so the time the
  user spends deciding never counts against it. But unlike `update_document`
  (TOCTOU fix #238), the table path **does not re-check the document after the
  dialog**. If the document closes while the dialog is open, the emit still
  goes out and the caller still gets 202.
- **`window_label: None` means broadcast.** `emit` reaches every webview, and
  each one filters on the label. The label is `None` only when the document
  vanished between two lock acquisitions, or when a poisoned mutex is swallowed
  by `.ok().flatten()`. In either case every window logs "not found". E23
  (WI-4.21, not started) plans to move this routing to `emit_to`.
- **The contract is barely published.** The table routes are missing from
  `specs/007-mcp-server/contracts/http-api.yaml` and `mcp-tools.json`. The
  in-tree MCP bridge (`src-tauri/src/bin/mdpro_mcp.rs`) does not expose them:
  its four tools are `get_open_documents`, `read_document`, `write_document`
  and `insert_content`. The only published contract is `docs/guide/tables.md`
  ("return `202 Accepted`"). Any caller is a local HTTP client holding the token.
- **Rust has no table parser, by design.** The table-CRUD plan (archived,
  WI-3.3) said "do not reinvent table parsing in Rust". ADR-0009 and ADR-0013
  both describe defects caused by two table detectors that disagree.

### Options considered

**(1) Acknowledgement round-trip.** Rust tags the event with a `request_id`
and parks a oneshot channel in a pending map. The frontend replies through a
new command, `mcp_table_action_result { request_id, outcome }`, where outcome
is `applied`, `refused { reason }` or `not_found`. Rust waits up to a named
timeout. *Multi-window:* it only works when exactly one window answers, so
`window_label: None` must fail closed rather than broadcast. That pulls E23's
`emit_to` forward for this one event. *Dialog:* no interaction, because the
timer starts after the emit. *Compatibility:* "applied" still returns 2xx, so
clients that test `is_success()` keep working. "Refused" becomes 4xx, which is
the whole point. *Testing:* the pending map is plain Rust (resolve, timeout,
late ack, unknown id, window closed mid-wait). The discriminated outcome is a
pure TS function.

**(2) Rust pre-validation against the shadow store.** Port `findAllTables`,
`makeIsFenced` and `refuseTableWrite` to Rust, and reject before emitting.
*Multi-window and dialog:* both unaffected. *Compatibility:* the same 4xx
change as (1). *Testing:* the second implementation needs a differential
corpus test against the TS scanner forever. The drift cost is the real
objection: this rebuilds exactly the two-parser disagreement ADR-0013 names as
the defect class. The shadow store can also be up to 300 ms stale. And
pre-validation cannot see the Milkdown failure or the partial apply.

**(3) Keep 202, rename it `scheduled`, and add a query endpoint.** Document
that 202 means "delivered, not applied", and add
`GET /api/v1/table_actions/{request_id}`. *Compatibility:* no break. *But*
the query can only answer if the frontend reports outcomes. That is the same
new IPC command and the same per-request state as (1). The client also has to
poll, and Rust has to decide how long to keep outcomes. It costs as much as
(1) and is worse to use. The version without a query endpoint, documentation
only, leaves the silent failure in place and just describes it.

## Decision

Adopt **option (1)**.

1. Every `TableActionEvent` carries a `request_id`. `dispatch_table_action`
   re-validates the document **after** the confirmation dialog, matching #238.
   It then resolves the owning window. If there is no owning window, it returns
   `409 WINDOW_UNRESOLVED` without emitting, and uses `emit_to` otherwise.
2. `applyMcpTableAction` returns a discriminated result instead of `null`. The
   reasons are `table_not_found` (ordinal out of range), `coords_out_of_range`,
   `invalid_payload`, `write_refused:<TableWriteRefusalReason>`,
   `editor_apply_failed` and `document_not_found`. The frontend flushes
   `syncNow` for the document **before** acknowledging `applied`, so a
   `read_document` sent after a 200 sees the new content.
3. Responses: `applied` → `200 {status:"applied", request_id}`. `refused` →
   `422 {code:"TABLE_WRITE_REFUSED", reason}`. `not_found` → `404`. Timeout →
   **`202 {status:"pending", request_id}`**, which means *outcome unknown*, not
   failure. The apply may still land later, for example in a webview blocked by
   a D6/D12-sized document. A late acknowledgement is logged and then dropped.
   `scheduled: true` stays in the 200 and 202 bodies for one release.
4. The six routes are added to `http-api.yaml`, and `docs/guide/tables.md` is
   rewritten in the same change.

## Consequences

- **"Applied" still does not mean the right table.** An ordinal that ADR-0013's
  under-detection shift sends to the wrong table is structurally valid, so it
  reports `applied`. This ADR turns *refused-but-reported-as-success* into an
  error. It does **not** fix *wrong-target-reported-as-success*. Table identity
  remains a separate contract change.
- **The timeout adds a third state that clients must handle.** `pending`
  cannot be retried safely: repeating `add_row` after a late apply adds two
  rows. With no query endpoint, a pending client is back to reading the
  document and guessing. The timeout value will be a policy choice, not a
  measurement.
- **HTTP latency now depends on how responsive the webview is.** Normally that
  adds milliseconds. On a hung webview, every table call waits for the full
  timeout. The fire-and-forget design gave this up for simplicity.
- **Rust gains shared mutable state** (the pending map). It needs cleanup on
  `remove_window` and review against rule 60's race-condition checks. There is
  also a new `#[tauri::command]`, which needs its own ledger row.
- **It is a contract break.** A client that treated every 202 as success now
  gets 4xx for refused writes. No in-tree client exists, and the routes were
  never in the published spec, so that is the only reason the break is cheap.
- **Part of E23 moves forward.** `emit_to` for this one event lands before
  WI-4.21. That item then has one fewer event to route, and one precedent it
  must follow.
- **It rules out option (2) for tables.** Rust stays a thin transport, and the
  TS scanner stays the only definition of "which table is table N".
