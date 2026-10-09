# Tables in mdpro

Tables in mdpro use [GitHub-Flavored Markdown (GFM)](https://github.github.com/gfm/#tables-extension-)
syntax. Everything you can do in the editor round-trips through plain
markdown — the file is the source of truth.

## Inserting a table

| How | Detail |
|---|---|
| Keyboard | `⌘ Option T` (`paragraphTable` shortcut) — opens the Insert Table picker |
| Menu | Format → Insert Table — same picker |
| The picker | Hover the 10×10 grid to preview rows × cols, or type bigger sizes (1–50) into the numeric inputs. Enter inserts. |

The cursor lands in the first header cell after insertion so you can type column names.

## Editing cells

| Keys | Action |
|---|---|
| `Tab` | Next cell. On the last cell of the last row, appends a new row. |
| `Shift Tab` | Previous cell. |
| `Esc` | Exit the table to a paragraph after it. |
| Right-click | Open the table context menu (insert/delete row/column, alignment, move, delete table). |

## Column alignment

Right-click any cell → Alignment → Left / Center / Right. The choice is
stored in the markdown delimiter row using standard GFM syntax:

```
| Default | Left | Center | Right |
| ------- | :--- | :----: | ----: |
| 1       | 2    | 3      | 4     |
```

Alignment renders consistently in the WYSIWYG editor and in exported HTML.

## Column widths — session-local only

You can drag the right edge of any column to resize it. **The new width is
not persisted to markdown** — GFM has no syntax for column widths. The
width sticks for the current editing session and is reset when:

- The document is closed and reopened
- The app is restarted
- The view mode toggles between WYSIWYG and Source

This is a deliberate trade-off to keep the markdown file portable across
other tools (Typora, GitHub, vmark, etc.). If you need fixed column
widths in exported HTML, use the export's CSS to set `width:` per column.

## Reformat / pretty-print

Right-click any table → **Format → Reformat table** to pad cells
column-by-column so the source-mode pipes line up. Alignment markers
(`:--`, `:-:`, `--:`) are preserved. Escaped pipes (`\|`) inside cell
content round-trip correctly.

In WYSIWYG mode the menu item is present but it's a visible no-op —
Milkdown's GFM serializer always emits compact (unpadded) markdown on
every keystroke, which would immediately overwrite a formatted version.
Toggle to source mode to apply.

### Auto-format on save (Settings opt-in)

Settings → Markdown → **Auto-Reformat Tables on Save** (off by default)
runs the formatter over every table in the document on each save.
Off by default because pretty-printing produces noisy diffs in
version-controlled files; turn it on if you prefer canonical-looking
markdown.

## Column-count linter (source mode)

In source mode, mdpro flags any table body row whose number of cells
differs from the header. The diagnostic appears as a gutter warning
(yellow triangle) on the offending row; hover or use the gutter to see
the detail (`Table row has N cells but header has M`).

The check ignores tables inside fenced code blocks and respects
escaped pipes (`\|`) inside cell content.

## Wide tables — horizontal scroll

When a table's natural width (the sum of its column widths) exceeds the
editor content area, the table becomes horizontally scrollable inside
its own wrapper. Header and body cells stay aligned because the wrapper
encapsulates the whole table.

The inner table sizes by `max-content`, so the scroll appears as soon
as the cumulative column widths cross the editor edge — whether you
typed long content into a cell or dragged a column wider with the
resize handle. Narrow tables continue to fill the editor at 100%.

## Limitations

mdpro v1 supports the GFM table dialect:

- Cells contain inline-only content (no lists, no nested tables, no code blocks). This is the GFM spec.
- No `rowspan` / `colspan` (also GFM).
- Column widths are session-local (see above).
- Tables inside blockquotes (`> | a | b |`) are not supported in v1; mdpro treats those lines as a blockquote paragraph.

## MCP table tools (external automation)

mdpro's MCP HTTP server exposes six endpoints for table manipulation
(Phase 3 WI-3.3). All routes accept JSON, require the same token +
origin auth as the existing `/api/documents/*` routes, and return
`202 Accepted` (the frontend applies the change asynchronously and
the result is visible on the next `GET /api/documents/{id}`).

| Endpoint | Payload | Effect |
|---|---|---|
| `POST /api/v1/insert_table` | `{document_id, rows, cols, alignments?}` | Append a new empty table to the document |
| `POST /api/v1/set_cell` | `{document_id, table_index?, row, col, content}` | Replace one cell's content |
| `POST /api/v1/add_row` | `{document_id, table_index?, after}` | Insert a new row after the given row index |
| `POST /api/v1/delete_row` | `{document_id, table_index?, index}` | Delete the row at the given index |
| `POST /api/v1/add_column` | `{document_id, table_index?, after}` | Insert a new column after the given column index |
| `POST /api/v1/delete_column` | `{document_id, table_index?, index}` | Delete the column at the given index |

`table_index` defaults to `0` (the first table in the document) if
omitted. `row` and `col` are 0-based; row 0 is the header.

A body row with more cells than the header is widened before any edit
(D49, [ADR-0064](../adr/0064-mcp-table-actions-widen-and-keep-header-width-coordinates.md)),
so its extra cells survive as new columns under an empty header cell.
`col` is still bounded by the header width, so an overflow cell can only
be addressed after a first write has widened the header.

The architecture is **frontend-driven**: Rust validates inputs and
forwards a high-level intent to the frontend (`mcp:table_action`
event). The frontend computes the new content via the shared TS
parser/edits and pushes back to the shadow store. This avoids
shipping a second table parser in Rust at the cost of asynchronous
confirmation — ideal for desktop where the frontend reacts in
microseconds, less ideal for headless automation that needs strict
request/response.

## See also

- Keyboard shortcuts: [`keyboard-shortcuts.md`](./keyboard-shortcuts.md)
- Image resize (the parallel feature): tracking issue #389
- Table CRUD design + plan: `docs/plans/20260502-plan-table-crud.md`
