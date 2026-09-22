---
name: mcp-dev
description: MCP server development for mdpro — rmcp binary structure, shadow store, HTTP API routes, token auth, and adding new tools.
---

# MCP Dev Skill

Reference guide for extending mdpro's MCP server (`src-tauri/src/bin/mdpro_mcp.rs`) and HTTP API (`src-tauri/src/services/http_server.rs`).

---

## 1. Architecture Overview

```
Claude Code
    │  (stdio JSON-RPC 2.0)
    ▼
mdpro_mcp binary (src-tauri/src/bin/mdpro_mcp.rs)
    │  (HTTP + X-MDPRO-Token)
    ▼
axum HTTP server (src-tauri/src/services/http_server.rs)
    │  (in-memory shadow store)
    ▼
Shadow Store (src-tauri/src/services/shadow_store.rs)
    │  (Tauri events: mcp:write_document, mcp:insert_content)
    ▼
Frontend (React + Milkdown/CodeMirror)
```

The MCP binary is a **separate process** — it communicates with the running Tauri app via HTTP, not in-process. The Tauri app starts the MCP server as a sidecar.

---

## 2. Config + Auth

### Server config files

Platform data dir, `dirs::data_dir()/mdpro/` (macOS shown below). **Not** `~/.mdpro/` —
that directory holds the log and preferences only.

```
~/Library/Application Support/mdpro/server.port    # e.g., "55045"
~/Library/Application Support/mdpro/server.token   # 64-char hex token, 0600 perms
```

### Loading config in MCP binary

```rust
// src-tauri/src/bin/mdpro_mcp.rs
use std::fs;

struct ServerConfig {
    port: u16,
    token: String,
}

impl ServerConfig {
    fn load() -> Result<Self, String> {
        // dirs::data_dir() — macOS: ~/Library/Application Support
        let dir = dirs::data_dir().ok_or("no data dir")?.join("mdpro");
        let port: u16 = fs::read_to_string(dir.join("server.port"))
            .map_err(|e| format!("read port: {}", e))?
            .trim().parse()
            .map_err(|e| format!("parse port: {}", e))?;
        let token = fs::read_to_string(dir.join("server.token"))
            .map_err(|e| format!("read token: {}", e))?
            .trim().to_string();
        Ok(ServerConfig { port, token })
    }
}
```

### Token auth in HTTP requests (from MCP binary)

```rust
let response = client
    .get(format!("http://localhost:{}/api/documents", config.port))
    .header("X-MDPRO-Token", &config.token)
    .send()
    .await?;
```

---

## 3. Shadow Store

The shadow store holds document state in Rust memory, synced from the frontend:

```rust
// src-tauri/src/services/shadow_store.rs
pub struct ShadowStore {
    documents: HashMap<String, ShadowDocument>,
}

pub struct ShadowDocument {
    pub id: String,
    pub title: String,
    pub path: Option<PathBuf>,
    pub content: String,
    pub cursor: usize,
    pub is_dirty: bool,
}
```

**Sync trigger:** Frontend calls `mcp_sync_documents` Tauri command (debounced 300ms for content changes). The shadow store is updated atomically.

**Rule:** MCP tool handlers **always** read from the shadow store, never from disk directly.

---

## 4. Existing HTTP API Routes

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/status` | App version, window focus |
| `GET` | `/api/documents` | List all open docs |
| `POST` | `/api/documents/new` | Create new document |
| `GET` | `/api/documents/{id}` | Read document content + cursor |
| `POST` | `/api/documents/{id}` | Write (full replace) document content |
| `POST` | `/api/documents/{id}/insert` | Insert text at position |

All routes require `X-MDPRO-Token` header. The server validates origin (`localhost` only).

---

## 5. Adding a New MCP Tool — 3-Step Process

### Step 1: Add HTTP endpoint (in `http_server.rs`)

```rust
// src-tauri/src/services/http_server.rs
async fn save_document(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    // Emit Tauri event → frontend saves the file
    state.app_handle
        .emit("mcp:save_document", &id)
        .map_err(|e| format!("emit failed: {}", e))?;
    Json(json!({ "ok": true }))
}

// Register in the axum router:
.route("/api/documents/:id/save", post(save_document))
```

### Step 2: Add MCP tool (in `mdpro_mcp.rs`)

```rust
// src-tauri/src/bin/mdpro_mcp.rs
use rmcp::tool;

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
struct SaveDocumentArgs {
    /// Document ID to save
    id: String,
}

#[tool(description = "Save a document to disk. Shows a native save dialog if the document has no path.")]
async fn save_document(&self, args: SaveDocumentArgs) -> String {
    let url = format!("http://localhost:{}/api/documents/{}/save", self.config.port, args.id);
    match self.client.post(&url)
        .header("X-MDPRO-Token", &self.config.token)
        .send().await
    {
        Ok(resp) if resp.status().is_success() => "Saved.".to_string(),
        Ok(resp) => format!("Server error: {}", resp.status()),
        Err(e) => format!("Request failed: {}", e),
    }
}
```

### Step 3: Register in the tool list

```rust
// In mdpro_mcp.rs, in the #[tool_list] impl or equivalent registration
// (follow the existing pattern for get_open_documents, read_document, etc.)
```

---

## 6. Event Flow for Write Operations

When `write_document` is called via MCP:

```
MCP tool call → HTTP POST /api/documents/{id}
    → http_server.rs handler
    → shadow_store.update_content(id, new_content)
    → app_handle.emit("mcp:write_document", { id, content })
    → frontend useMcpEvents hook
    → calls editor.replaceAll(content) (Milkdown) or setContent (CodeMirror)
```

The frontend is notified via the Tauri event — the MCP server never writes to disk directly.

---

## 7. Confirmation Dialog

`write_document` shows a native confirmation dialog when the app window is not focused (to prevent background overwrites):

```rust
// src-tauri/src/services/http_server.rs
fn show_write_confirmation(app: &AppHandle) -> bool {
    // Uses rfd::MessageDialog
    // Returns true if user confirms
}
```

This prevents surprise overwrites when Claude edits a document the user is actively reading. Don't skip this check in new write operations.

---

## 8. Adding a New Resource (MCP Resources)

MCP resources are auto-loaded into Claude's context at session start (no tool call needed). To add a resource:

```rust
// In mdpro_mcp.rs, implement the resources/list + resources/read handlers
// using rmcp's resource registration pattern

// Resource URI convention: mdpro://document/outline, mdpro://document/metadata
```

Resources are higher-value than tools for frequently-needed context (document outline, metadata) because they don't consume a tool call turn.

---

## 9. Testing MCP Changes

```bash
# 1. Start the app
pnpm tauri dev

# 2. Check server is running (macOS data dir; see dirs::data_dir())
MDPRO_DIR="$HOME/Library/Application Support/mdpro"
curl -s -H "X-MDPRO-Token: $(cat "$MDPRO_DIR/server.token")" \
  "http://localhost:$(cat "$MDPRO_DIR/server.port")/api/status" | jq .

# 3. Test a specific endpoint
curl -s -H "X-MDPRO-Token: $(cat "$MDPRO_DIR/server.token")" \
  "http://localhost:$(cat "$MDPRO_DIR/server.port")/api/documents" | jq .

# 4. Watch logs
tail -f ~/.mdpro/mdpro.log | jq 'select(.event | startswith("mcp."))'
```
