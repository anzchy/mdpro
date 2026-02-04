# Research: mdpro MCP Server

**Date**: 2026-02-04
**Branch**: 007-feat/mcp-server

## 1. HTTP Framework: axum vs warp

### Decision: **axum**

### Rationale
1. **Tokio Integration**: axum is part of the official Tokio project ecosystem. Tauri already uses tokio, so integration is seamless with no runtime conflicts.
2. **Middleware**: Tower middleware ecosystem provides out-of-the-box solutions for token validation and CORS. `tower-http::cors` and custom middleware via `middleware::from_fn()` cover our security requirements (X-MDPRO-Token, Origin check).
3. **Active Maintenance**: axum 0.8.0 released January 2025, active development toward 0.9.x. warp's last release was September 2022.
4. **Adoption**: Widely used in production, excellent documentation and examples.

### Alternatives Considered
- **warp**: Slightly smaller footprint but in maintenance mode. Filter-based middleware is less intuitive than Tower. Community notes learning curve for auth patterns.

### Implementation Reference
```rust
use axum::{Router, routing::{get, post}, middleware, State};
use tower::middleware::from_fn;

let app = Router::new()
    .route("/api/status", get(status_handler))
    .route("/api/documents", get(list_documents))
    .route("/api/documents/:id", get(get_document).post(update_document))
    .route("/api/documents/:id/insert", post(insert_content))
    .route("/api/documents/new", post(create_document))
    .layer(from_fn(validate_token))
    .layer(from_fn(validate_origin));
```

### Dependencies
```toml
axum = { version = "0.8", features = ["macros"] }
tower = "0.5"
tower-http = { version = "0.5", features = ["cors", "trace"] }
```

---

## 2. MCP Server SDK: rmcp

### Decision: **rmcp** (modelcontextprotocol/rust-sdk)

### Rationale
1. **Official SDK**: Maintained by Anthropic, part of the official MCP ecosystem.
2. **Production Ready**: Used in high-performance implementations (4,700+ queries/sec documented).
3. **stdio Transport**: Full support via `StdioTransport` with JSON-RPC over stdin/stdout.
4. **Ergonomic API**: `#[tool]` macro for tool registration, `#[tool_box]` for grouping.
5. **Type Safety**: Automatic JSON schema generation from Rust types.

### Alternatives Considered
- **rust-mcp-sdk**: Production-ready, latest protocol support, but not official.
- **mcpkit**: Minimal boilerplate with `#[mcp_server]` macro, but newer and less battle-tested.

### Implementation Reference
```rust
use rmcp::{Server, tool, Tool};

#[tool(description = "Get list of open documents in mdpro")]
async fn get_open_documents() -> Result<Vec<DocumentInfo>, ToolError> {
    // HTTP call to mdpro
}

#[tool(description = "Read document content by ID")]
async fn read_document(id: String) -> Result<DocumentContent, ToolError> {
    // HTTP call to mdpro
}
```

### Dependencies
```toml
rmcp = { version = "0.13", features = ["server", "transport-io"] }
reqwest = { version = "0.11", features = ["json"] }
anyhow = "1"
tracing = "0.1"
```

---

## 3. Shadow Store Architecture

### Decision: **Frontend as source, Rust mirrors via invoke**

### Rationale
1. **Current Architecture**: All document state lives in frontend Zustand. Rust is stateless per command.
2. **Minimal Disruption**: Adding a Rust-side mirror doesn't require restructuring existing commands.
3. **Clear Ownership**: Frontend owns editing state, Rust mirrors for MCP access.
4. **Debounce**: 300ms debounce on content changes balances freshness vs. IPC overhead.

### Implementation Pattern
```
Frontend Document Change
    ↓ (debounce 300ms for content, immediate for open/close/switch)
invoke("mcp_sync_documents", { documents, activeId, focusedWindow })
    ↓
Rust Shadow Store (Mutex<HashMap<String, DocumentState>>)
    ↓ (on MCP request)
axum HTTP Server reads Shadow Store
```

### Multi-Window Handling
- Each window has its own `documentStore` in Zustand
- Shadow Store must track which window each document belongs to
- MCP requests route to "most recently focused" window's documents
- Window focus tracked via `WindowEvent::Focused` in Rust

### Sync Payload
```typescript
interface SyncPayload {
  windowLabel: string;
  documents: DocumentState[];
  activeDocumentId: string | null;
}

interface DocumentState {
  id: string;
  title: string;
  path: string | null;
  content: string;
  cursor: number;
  isDirty: boolean;
}
```

---

## 4. Security Implementation

### Token Mechanism
1. mdpro generates random token on startup: `uuid::Uuid::new_v4().to_string()`
2. Writes to `~/.mdpro/server.token` (file permissions 600)
3. `mdpro-mcp` reads token on startup, includes in `X-MDPRO-Token` header
4. axum middleware validates token on every request

### Origin Validation
1. Allow only `Origin: null` (for local file:// or no-origin requests) or trusted localhost origins
2. Reject requests with external Origin headers (DNS rebinding protection)

### Error Responses
| Scenario | HTTP Status | MCP Error |
|----------|-------------|-----------|
| Missing token | 401 | N/A (HTTP layer) |
| Invalid token | 401 | N/A (HTTP layer) |
| Invalid origin | 403 | N/A (HTTP layer) |
| mdpro not running | N/A | `"mdpro not running"` |
| User rejects write | 200 | `"User rejected write operation"` |

---

## 5. Binary Distribution

### Decision: **Separate binary, bundled with app**

### Rationale
1. MCP clients expect to spawn a subprocess. `mdpro-mcp` must be a standalone executable.
2. Bundling with mdpro.app ensures version compatibility.
3. Single Rust workspace allows shared code (models, error types).

### Implementation
- Binary at `src-tauri/src/bin/mdpro_mcp.rs`
- Build with `cargo build --bin mdpro_mcp --release`
- Bundle in `mdpro.app/Contents/MacOS/mdpro-mcp`
- Tauri config: add to `bundle.externalBin`

### User Configuration
```json
// ~/.claude_code/mcp.json
{
  "mcpServers": {
    "mdpro": {
      "command": "/Applications/mdpro.app/Contents/MacOS/mdpro-mcp"
    }
  }
}
```

---

## 6. Write Confirmation UX

### Decision: **Auto-approve if focused, dialog if backgrounded**

### Implementation
1. Check `Window::is_focused()` for the target window
2. If focused: Apply write immediately, return success
3. If backgrounded: Show native dialog via `rfd::MessageDialog`
4. If user rejects: Return MCP error `"User rejected write operation"`

### Dialog Design
```
Title: mdpro - Write Confirmation
Message: An external tool wants to replace the content of "{document_title}".
Buttons: [Allow] [Deny]
```

---

## Sources
- [tokio-rs/axum GitHub](https://github.com/tokio-rs/axum)
- [modelcontextprotocol/rust-sdk](https://github.com/modelcontextprotocol/rust-sdk)
- [Shuttle: How to Build a stdio MCP Server in Rust](https://www.shuttle.dev/blog/2025/07/18/how-to-build-a-stdio-mcp-server-in-rust)
- [MCP Specification](https://modelcontextprotocol.io/specification)
