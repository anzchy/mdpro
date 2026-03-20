# vmark MCP Tools vs mdpro MCP Tools: Comparison & Borrowing Guide

**Date:** 2026-03-12
**Source:** [github.com/xiaolai/vmark](https://github.com/xiaolai/vmark) — `vmark-mcp-server/`
**Context:** Evaluate which vmark MCP tools are worth adding to mdpro's MCP server (`src-tauri/src/bin/mdpro_mcp.rs`)

---

## 1. mdpro Current MCP Tools (4 tools)

mdpro's MCP server (`src-tauri/src/bin/mdpro_mcp.rs`) exposes exactly **4 tools**, all via the internal HTTP API at `localhost:{PORT}` with token auth:

| Tool | HTTP Endpoint | What it Does |
|------|---------------|--------------|
| `get_open_documents` | `GET /api/documents` | List all open documents (id, title, path, is_dirty) |
| `read_document` | `GET /api/documents/{id}` | Read document content + cursor position |
| `write_document` | `POST /api/documents/{id}` | Full-replace document content (with confirmation dialog if window not focused) |
| `insert_content` | `POST /api/documents/{id}/insert` | Insert text at cursor/start/end/offset |

**Also in HTTP API but NOT exposed as MCP tools:**
- `GET /api/status` — app version, window focus state
- `POST /api/documents/new` — create a new document

**MCP Resources:** None currently defined.

---

## 2. vmark MCP Tools (38 tools + 4 resources)

vmark's `vmark-mcp-server` exposes a far richer surface built on a WebSocket bridge to the running editor. All tools support an optional `windowId` parameter for multi-window targeting.

### Document Operations (6)
| Tool | What it Does |
|------|--------------|
| `document_get_content` | Get full document text |
| `document_set_content` | Replace entire document |
| `document_insert_at_cursor` | Insert at current cursor position |
| `document_insert_at_position` | Insert at specific character offset |
| `document_search` | Find text within document, returns matches with positions |
| `document_replace` | Find-and-replace within document |

### Selection & Cursor (6)
| Tool | What it Does |
|------|--------------|
| `selection_get` | Get currently selected text + range |
| `selection_set` | Set selection boundaries |
| `selection_replace` | Replace selected text |
| `selection_delete` | Delete selected text |
| `cursor_get_context` | Get N characters of surrounding text around cursor |
| `cursor_set_position` | Move cursor to character offset |

### Editor Actions (3)
| Tool | What it Does |
|------|--------------|
| `editor_undo` | Trigger undo |
| `editor_redo` | Trigger redo |
| `editor_focus` | Focus the editor window |

### Formatting (4)
| Tool | What it Does |
|------|--------------|
| `format_toggle` | Toggle bold/italic/code/strikethrough/underline |
| `format_set_link` | Create a hyperlink around selection |
| `format_remove_link` | Remove link from selection |
| `format_clear` | Strip all formatting from selection |

### Block-Level Elements (3)
| Tool | What it Does |
|------|--------------|
| `block_set_type` | Set block type (heading level, paragraph, code block) |
| `block_toggle` | Toggle between block types |
| `block_insert_horizontal_rule` | Insert `---` |

### Lists (3)
| Tool | What it Does |
|------|--------------|
| `list_toggle` | Toggle bullet / ordered / task list |
| `list_indent` | Increase nesting level |
| `list_outdent` | Decrease nesting level |

### Tables (7)
| Tool | What it Does |
|------|--------------|
| `table_insert` | Create a new table with N rows × M cols |
| `table_delete` | Remove current table |
| `table_add_row` | Insert row before/after cursor row |
| `table_delete_row` | Remove cursor row |
| `table_add_column` | Insert column before/after cursor column |
| `table_delete_column` | Remove cursor column |
| `table_toggle_header_row` | Toggle header row on/off |

### VMark-Specific Extensions (6)
| Tool | What it Does |
|------|--------------|
| `insert_math_inline` | Embed inline LaTeX |
| `insert_math_block` | Insert block-level LaTeX equation |
| `insert_mermaid` | Insert Mermaid diagram block |
| `insert_wiki_link` | Insert `[[wiki-style]]` link |
| `cjk_punctuation_convert` | Convert between full-width and half-width CJK punctuation |
| `cjk_spacing_fix` | Auto-fix spacing between CJK and Latin characters |

### Workspace Management (7)
| Tool | What it Does |
|------|--------------|
| `workspace_list_windows` | List all open editor windows |
| `workspace_get_focused` | Get focused window identifier |
| `workspace_focus_window` | Switch to a specific window |
| `workspace_new_document` | Create new document in a window |
| `workspace_open_document` | Open a file by path |
| `workspace_save_document` | Save current document to disk |
| `workspace_close_window` | Close a window |

### MCP Resources (4)
| Resource URI | What it Returns |
|--------------|-----------------|
| `vmark://document/outline` | Heading hierarchy (TOC structure as JSON) |
| `vmark://document/metadata` | File path, title, word count, last modified |
| `vmark://windows/list` | All open window labels |
| `vmark://windows/focused` | Current focused window label |

---

## 3. Gap Analysis

| Category | mdpro | vmark | Gap |
|----------|-------|-------|-----|
| Read document content | ✓ | ✓ | — |
| Write document (full replace) | ✓ | ✓ | — |
| Insert at position | ✓ | ✓ | — |
| Insert at cursor | ✓ (via "cursor" string) | ✓ | Partial |
| **Search within doc** | ✗ | ✓ | **Missing** |
| **Find & replace** | ✗ | ✓ | **Missing** |
| **Selection get/set** | ✗ | ✓ | **Missing** |
| **Cursor context** | ✗ | ✓ | **Missing** |
| **Undo / Redo** | ✗ | ✓ | **Missing** |
| **Save to disk** | ✗ | ✓ | **Missing** |
| **Open file by path** | ✗ | ✓ | **Missing** |
| **Create new document** | in HTTP API only | ✓ | **Not exposed as MCP** |
| List open documents | ✓ | ✓ (workspace_list_windows) | — |
| Formatting (bold/link/etc.) | ✗ | ✓ | Out of scope for now |
| Block type control | ✗ | ✓ | Out of scope |
| Table manipulation | ✗ | ✓ | Out of scope |
| **Document metadata resource** | ✗ | ✓ | **Useful** |
| **TOC/outline resource** | ✗ | ✓ | **Useful** |
| Math/Mermaid insertion | ✗ | ✓ | N/A (not in mdpro) |
| CJK text utilities | ✗ | ✓ | Low priority |

---

## 4. Recommended Tools to Borrow from vmark

Prioritized by impact-to-effort ratio for mdpro's architecture. All are feasible via the existing HTTP API layer (add endpoint → expose as MCP tool).

### Tier 1 — High Value, Low Effort (borrow directly)

#### `save_document`
- **Why:** `write_document` updates in-memory content, but there's no MCP tool to persist to disk. Claude can edit a doc but can't save it without asking the user to press `⌘S`.
- **How:** Add `POST /api/documents/{id}/save` → emits `mcp:save_document` Tauri event → calls existing `save_file` Tauri command.
- **MCP signature:**
```json
{
  "name": "save_document",
  "description": "Save a document to disk. Triggers a native save dialog if the document has no path.",
  "parameters": {
    "id": "string"
  }
}
```

#### `create_document` (expose existing HTTP endpoint)
- **Why:** Already exists as `POST /api/documents/new` in `http_server.rs` but is NOT registered in `mdpro_mcp.rs`. Zero backend work needed — just add the MCP tool wrapper.
- **MCP signature:**
```json
{
  "name": "create_document",
  "description": "Create a new empty document in mdpro.",
  "parameters": {
    "content": "string (optional initial content)"
  }
}
```

#### `open_document`
- **Why:** Allows Claude to open a specific file by path — critical for file-manipulation workflows ("open ~/notes/todo.md and add an item").
- **How:** Add `POST /api/documents/open` → emits `mcp:open_document` event → calls existing `open_file` Tauri command.
- **MCP signature:**
```json
{
  "name": "open_document",
  "description": "Open a markdown file from disk by its absolute path.",
  "parameters": {
    "path": "string (absolute file path)"
  }
}
```

### Tier 2 — High Value, Medium Effort

#### `search_document`
- **Why:** Claude can currently only read the full document. To find a specific section to edit, it must parse the entire content itself. A search tool lets Claude pinpoint positions before calling `insert_content` or `write_document`.
- **How:** Implement in Rust — `shadow_store` has the content; run substring/regex search and return match offsets.
- **MCP signature:**
```json
{
  "name": "search_document",
  "description": "Search for text within a document. Returns all match positions.",
  "parameters": {
    "id": "string",
    "query": "string",
    "regex": "boolean (optional, default false)",
    "case_sensitive": "boolean (optional, default false)"
  },
  "returns": "[{ match: string, start: number, end: number, line: number }]"
}
```

#### `replace_in_document`
- **Why:** Surgical text replacement without full `write_document` (safer, avoids confirmation dialog when window is focused).
- **How:** Server-side find-replace on shadow store content; emit `mcp:write_document` with updated text.
- **MCP signature:**
```json
{
  "name": "replace_in_document",
  "description": "Find and replace text in a document. Returns count of replacements made.",
  "parameters": {
    "id": "string",
    "find": "string",
    "replace_with": "string",
    "all": "boolean (default true)"
  }
}
```

#### `cursor_get_context`
- **Why:** Without cursor context, Claude must read the entire document to understand where to insert. This tool returns N characters before/after cursor — critical for precise editing assistance.
- **How:** Shadow store already tracks `cursor` offset. Return `content[cursor-N..cursor+N]`.
- **MCP signature:**
```json
{
  "name": "cursor_get_context",
  "description": "Get text surrounding the current cursor position.",
  "parameters": {
    "id": "string",
    "chars_before": "number (default 200)",
    "chars_after": "number (default 200)"
  },
  "returns": "{ before: string, after: string, cursor_offset: number }"
}
```

### Tier 3 — Medium Value, Medium Effort

#### `get_document_metadata` (as MCP Resource)
- **Why:** vmark exposes `vmark://document/metadata` as a Resource — always available in Claude's context without a tool call. mdpro should expose the same as a resource.
- **Contents:** `{ path, title, word_count, char_count, is_dirty, encoding }`
- **How:** Register as MCP resource via rmcp's resource handler.

#### `get_document_outline` (as MCP Resource)
- **Why:** Exposes the TOC structure as a Resource (auto-loaded, no tool call needed). Claude can see the document outline at session start — crucial for navigating long documents.
- **Contents:** `[{ level: 1-6, text: string, anchor: string }]`
- **How:** Shadow store content → parse headings server-side (reuse Rust TOC logic from `toc.rs`).

#### `undo` / `redo`
- **Why:** After Claude uses `write_document`, the user may want to revert. Without MCP undo, they must manually press `⌘Z`. Claude can call `undo` to clean up its own changes.
- **How:** Emit `mcp:undo` / `mcp:redo` Tauri event → frontend calls editor undo action.
- **Note:** Only meaningful in WYSIWYG mode (Milkdown history plugin); CodeMirror `⌘Z` still available to user in source mode.

### Not Recommended (at this time)

| vmark Tool Category | Reason to Skip |
|--------------------|----------------|
| `format_toggle`, `format_set_link`, etc. | Requires deep Milkdown/ProseMirror command integration. Complex to implement correctly across view modes. |
| `block_set_type`, `block_toggle` | Same — ProseMirror transaction-level control. |
| `table_*` tools | Very complex; mdpro tables are simpler GFM text. |
| `insert_math_*`, `insert_mermaid` | mdpro doesn't support Math/Mermaid yet. |
| `cjk_punctuation_convert`, `cjk_spacing_fix` | Niche; can be done by Claude with `write_document` if needed. |
| `selection_set`, `selection_replace`, `selection_delete` | Requires cursor/selection state in shadow store, currently only offset stored. |

---

## 5. Implementation Roadmap

```
Phase 1 — Expose Existing (1-2 days)
  + create_document     (expose HTTP endpoint already built)
  + save_document       (new endpoint, trivial Tauri event)
  + open_document       (new endpoint, reuse open_file command)

Phase 2 — Read Enhancements (3-5 days)
  + search_document     (Rust server-side substring/regex search)
  + cursor_get_context  (shadow store already has cursor offset)
  + Resource: document/metadata
  + Resource: document/outline (reuse toc.rs parsing)

Phase 3 — Write Enhancements (3-5 days)
  + replace_in_document (server-side string replace on shadow content)
  + undo / redo         (Tauri event → editor action)
```

Total: ~3 weeks to reach parity with vmark's Tier 1+2 tools. Formatting/table tools are out of scope unless mdpro adopts a more structured WYSIWYG model.

---

## 6. Architecture Note: mdpro vs vmark Bridge Design

| Aspect | mdpro | vmark |
|--------|-------|-------|
| MCP↔Editor bridge | HTTP API (localhost + token) | WebSocket bridge (persistent, auto-reconnect) |
| Transport | REST (stateless per request) | WebSocket (stateful, event push) |
| Auth | Random 64-char hex token (file:// 600 perms) | Not detailed |
| Rate limiting | None currently | 100 req/sec with queue |
| Multi-window | Via `window_label` in shadow store | Via `windowId` parameter |
| Content sync | Frontend → Rust shadow store via `mcp_sync_documents` | WebSocket message push from editor |

vmark's WebSocket model supports **real-time streaming** (e.g., live cursor position updates) that mdpro's REST model cannot without polling. For mdpro's current use case (document editing, not real-time collaboration), REST is sufficient. The key missing piece is bidirectional state: vmark's bridge can push cursor/selection state from editor to MCP server; mdpro's shadow store only receives periodic syncs from the frontend.

**Future consideration:** Add a WebSocket endpoint to mdpro's HTTP server for real-time state push (cursor position, selection, word count) without breaking the existing REST tools.
