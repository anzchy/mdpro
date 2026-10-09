# 0064. MCP table actions widen, and coordinates stay header-width

**Status**: Accepted (2026-10-09, user decision after a Codex consult while fixing D49).

## Context

D49 (row in
[`docs/plans/20260912-frontend-backend-sequencing-order.md`](../plans/20260912-frontend-backend-sequencing-order.md#d49)):
the MCP/HTTP table actions dropped body cells past the header's column count.
`set_cell` serialized header-width rows (`src/utils/tableMcp.ts`), and
`add_row` / `delete_row` / `add_column` / `delete_column` went through the
same truncating edits as the source context menu. ADR-0052 left "widen versus
refuse" for MCP as its own lasting choice.

The forces as understood at the time:

- [ADR-0063](./0063-table-edits-widen-like-format-on-save.md) makes ⌘S and
  every context-menu edit widen. The four MCP row and column actions call the
  same `applyEdit`, so they widen too unless something stops them first.
- The HTTP route returns `202 Accepted` before the frontend applies the action
  (WI-3.3 Option B). A refusal could only be a warn line in the log. The
  client would learn of it only by reading the document back.
- Refusing would also refuse tables that look ordinary: a single trailing
  blank cell (`| 1 | 2 | |`) is overflow under ADR-0052 §2.
- Letting `set_cell` address overflow columns would change the external
  coordinate contract, and it collides with the header-width action gate the
  context menu shares.
- Options put to the user: A widen (A1 header-width bound, A2 widened bound),
  B refuse with `overflow_rows`, C keep rows ragged. Codex reviewed A and B.
  The user chose **A1**.

## Decision

1. Every MCP table action that rewrites a table widens it first, through the
   shared `src/utils/tableWiden.ts`, the same mechanism as format-on-save and
   the context menu. Nothing on the MCP path truncates.
2. `set_cell`'s column bound stays the **header** width. A call aimed at an
   overflow column is rejected as an invalid payload, as before.
3. The route stays `202 Accepted`. No synchronous result is added here.
4. `set_cell` logs `editor.table.edit-widened` with `action: "set_cell"` when
   it widened. The row and column actions log through `applyEdit` with their
   own action id. The log does not say whether the caller was MCP or the menu.
5. `insert_table` is unchanged; it writes a new table.

## Consequences

- MCP, ⌘S and the context menu agree. Tables without overflow are written
  byte-identically to before.
- **An MCP write changes the rendered table.** Hidden overflow becomes visible
  columns under a blank header, on any table action, not only `set_cell`.
- **Overflow columns are unaddressable before the first write and
  addressable after it.** The first write widens the header, so the parsed
  column count grows and the same `col` that was rejected becomes valid. A
  client sees the bound move under it.
- **The confirm prompt does not mention widening.** It shows only
  `table:<action>`; the user approves a one-cell change and gets new columns.
- **The client cannot see that widening happened.** The 202 carries no result,
  and the shadow-store sync is debounced (300 ms, `src/hooks/useMcpSync.ts`),
  so a `read_document` right after the call may still show the old table. A
  synchronous acknowledgement with `{fromColCount, toColCount, widened}` is
  filed as [D57](../plans/20260912-frontend-backend-sequencing-order.md#d57),
  deferred until a table tool is exposed through the MCP sidecar. Today only
  the `/api/v1/*` HTTP routes reach these actions.
- A refused-with-reason path (option B) is foreclosed for now. Reopening it
  needs a new ADR and the D57 acknowledgement to carry the refusal.
- The splitter agreement (RC-6) now protects MCP writes too.
- Unchanged by this decision and filed as
  [D58](../plans/20260912-frontend-backend-sequencing-order.md#d58): table
  actions do not flush pending WYSIWYG edits before rewriting, and the store
  is written before Milkdown's `replaceAll`.
