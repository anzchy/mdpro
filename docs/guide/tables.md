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

Alignment renders consistently in the WYSIWYG editor, the Preview pane,
and exported HTML.

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

## Limitations

mdpro v1 supports the GFM table dialect:

- Cells contain inline-only content (no lists, no nested tables, no code blocks). This is the GFM spec.
- No `rowspan` / `colspan` (also GFM).
- Column widths are session-local (see above).
- Tables inside blockquotes (`> | a | b |`) are not supported in v1; mdpro treats those lines as a blockquote paragraph.

## See also

- Keyboard shortcuts: [`keyboard-shortcuts.md`](./keyboard-shortcuts.md)
- Image resize (the parallel feature): tracking issue #389
- Table CRUD design + plan: `docs/plans/20260502-plan-table-crud.md`
