# mdpro MCP Reference

## Architecture

```text
MCP client
  -> mdpro_mcp binary (`src-tauri/src/bin/mdpro_mcp.rs`)
  -> HTTP server (`src-tauri/src/services/http_server.rs`)
  -> shadow store (`src-tauri/src/services/shadow_store.rs`)
  -> Tauri events
  -> React editor
```

The MCP binary is a separate process. It talks to the running Tauri app over localhost HTTP using `X-MDPRO-Token`.

## Config And Auth

Server config:

```text
~/.mdpro/server.port
~/.mdpro/server.token
```

HTTP requests from the MCP binary include:

```rust
.header("X-MDPRO-Token", &config.token)
```

The HTTP server should validate localhost origin and token auth.

## Shadow Store

The shadow store is the source for MCP-visible document state:

```rust
pub struct ShadowDocument {
    pub id: String,
    pub title: String,
    pub path: Option<PathBuf>,
    pub content: String,
    pub cursor: usize,
    pub is_dirty: bool,
}
```

Rules:
- MCP handlers read from the shadow store, not directly from disk.
- Frontend syncs documents via `mcp_sync_documents`.
- Content changes are debounced; open/close/switch updates should be immediate.
- Watch for split-brain risk if shadow store updates succeed but frontend events fail.

## Existing Routes

| Method | Route | Description |
| --- | --- | --- |
| GET | `/api/status` | App version and focus |
| GET | `/api/documents` | List open docs |
| POST | `/api/documents/new` | Create document |
| GET | `/api/documents/{id}` | Read document |
| POST | `/api/documents/{id}` | Replace document content |
| POST | `/api/documents/{id}/insert` | Insert content |

## Adding A Tool

1. Add or update an HTTP endpoint in `http_server.rs`.
2. Add the rmcp tool implementation in `mdpro_mcp.rs`.
3. Register the tool in the existing tool list pattern.
4. Add or update tests for arg validation and error paths.
5. Verify shadow store updates and frontend events remain consistent.

Write operations flow:

```text
MCP tool call
  -> HTTP POST
  -> shadow_store.update_content
  -> app_handle.emit("mcp:write_document", payload)
  -> frontend MCP hook
  -> editor replacement
```

## Confirmation

`write_document` shows a native confirmation dialog when the app window is not focused. Do not bypass this for write-like operations that can overwrite content.

## Testing

```bash
pnpm tauri dev
curl -s -H "X-MDPRO-Token: $(cat ~/.mdpro/server.token)" \
  "http://localhost:$(cat ~/.mdpro/server.port)/api/status" | jq .
curl -s -H "X-MDPRO-Token: $(cat ~/.mdpro/server.token)" \
  "http://localhost:$(cat ~/.mdpro/server.port)/api/documents" | jq .
tail -f ~/.mdpro/mdpro.log | jq 'select(.event | startswith("mcp."))'
```

