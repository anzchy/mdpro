# Data Model: mdpro MCP Server

**Date**: 2026-02-04
**Branch**: 007-feat/mcp-server

## Entities

### 1. DocumentState (Shadow Store)

Rust-side mirror of frontend document state for MCP access.

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocumentState {
    /// Unique document identifier (hash of path or UUID for unsaved)
    pub id: String,

    /// Display title (filename or "Untitled")
    pub title: String,

    /// Absolute file path (None for unsaved documents)
    pub path: Option<String>,

    /// Full document content (markdown)
    pub content: String,

    /// Cursor position, as a UTF-16 code-unit offset from the start of
    /// `content` (ADR-0021). NOT a byte offset and NOT a Unicode scalar
    /// index: an emoji counts as 2. Converted to a byte offset inside
    /// `http_server.rs` before the string is touched.
    pub cursor: usize,

    /// Whether document has unsaved changes
    pub is_dirty: bool,

    /// Whether this is the active document in its window
    pub is_active: bool,
}
```

**Relationships**:
- Belongs to one `WindowState`
- Synced from frontend `DocumentStore`

**Validation Rules**:
- `id`: Required, non-empty
- `cursor`: Must be ≤ the UTF-16 code-unit length of `content`. This line
  previously read `≤ content.len()`, which is a **byte** count in Rust and so
  named a different unit from the field's own doc comment seventeen lines
  above. That contradiction is what defect D10 came out of — both sides picked
  a unit reasonably and picked differently. Corrected per ADR-0021.

---

### 2. WindowState

Tracks per-window document state for multi-window routing.

```rust
#[derive(Debug, Clone, Default)]
pub struct WindowState {
    /// Tauri window label (e.g., "main", "mdpro-{uuid}")
    pub label: String,

    /// All documents open in this window
    pub documents: Vec<DocumentState>,

    /// ID of the active document in this window
    pub active_document_id: Option<String>,

    /// Last focused timestamp (for MRU routing)
    pub last_focused_at: i64,
}
```

**Relationships**:
- Contains many `DocumentState`
- Part of `ShadowStore`

---

### 3. ShadowStore

Global Rust-side state for MCP access.

```rust
#[derive(Debug, Default)]
pub struct ShadowStore {
    /// Window label -> WindowState
    pub windows: HashMap<String, WindowState>,

    /// Most recently focused window label
    pub focused_window: Option<String>,
}
```

**State Transitions**:
```
[Empty] → sync_documents → [Populated]
[Populated] → window_focused → [Updated focused_window]
[Populated] → window_closed → [Window removed]
```

**Thread Safety**:
```rust
pub type SharedShadowStore = Arc<Mutex<ShadowStore>>;
```

---

### 4. ServerConfig

HTTP server configuration persisted to disk.

```rust
pub struct ServerConfig {
    /// Localhost port (dynamically assigned)
    pub port: u16,

    /// Authentication token
    pub token: String,
}
```

**File Locations**:
- `~/.mdpro/server.port` - Port number (plain text)
- `~/.mdpro/server.token` - Auth token (plain text, mode 600)

**Lifecycle**:
- Created on mdpro startup
- Deleted on mdpro clean shutdown
- `mdpro-mcp` reads on its startup

---

### 5. MCP Tool Inputs/Outputs

#### get_open_documents

**Input**: None

**Output**:
```rust
#[derive(Serialize)]
pub struct DocumentInfo {
    pub id: String,
    pub title: String,
    pub path: Option<String>,
    pub is_dirty: bool,
}
```

---

#### read_document

**Input**:
```rust
#[derive(Deserialize)]
pub struct ReadDocumentInput {
    pub id: String,
}
```

**Output**:
```rust
#[derive(Serialize)]
pub struct ReadDocumentOutput {
    pub content: String,
    pub cursor: usize,
}
```

---

#### write_document

**Input**:
```rust
#[derive(Deserialize)]
pub struct WriteDocumentInput {
    pub id: String,
    pub content: String,
}
```

**Output**:
```rust
#[derive(Serialize)]
pub struct WriteDocumentOutput {
    pub success: bool,
}
```

**Errors**:
- `"User rejected write operation"` - User denied confirmation dialog

---

#### insert_content

**Input**:
```rust
#[derive(Deserialize)]
pub struct InsertContentInput {
    pub id: String,
    pub text: String,
    pub position: InsertPosition,
}

#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum InsertPosition {
    Cursor,
    Start,
    End,
    #[serde(untagged)]
    Offset(usize),
}
```

**Output**:
```rust
#[derive(Serialize)]
pub struct InsertContentOutput {
    pub success: bool,
    /// Where the caret is expected to land: a UTF-16 code-unit offset
    /// (ADR-0021), same unit as `DocumentState::cursor`.
    ///
    /// It is a **prediction**, not an observation. This response is returned
    /// before the frontend has applied the emitted event, so a user typing at
    /// the same moment ends up somewhere else.
    pub new_cursor: usize,
}
```

---

## HTTP API Request/Response Models

### Status Response

```rust
#[derive(Serialize)]
pub struct StatusResponse {
    pub version: String,
    pub window_focused: bool,
}
```

---

### Error Response

```rust
#[derive(Serialize)]
pub struct ErrorResponse {
    pub error: String,
    pub code: Option<String>,
}
```

HTTP Status Codes:
- 401: Missing or invalid token
- 403: Invalid origin
- 404: Document not found
- 500: Internal error

---

## Sync Protocol

### Frontend → Rust

**Command**: `mcp_sync_documents`

**Payload**:
```rust
#[derive(Deserialize)]
pub struct SyncDocumentsPayload {
    pub window_label: String,
    pub documents: Vec<DocumentState>,
    pub active_document_id: Option<String>,
}
```

**Trigger Conditions**:
| Event | Debounce |
|-------|----------|
| Document content change | 300ms |
| Document open | Immediate |
| Document close | Immediate |
| Tab switch | Immediate |
| Window focus change | Immediate |

---

### Rust → Frontend

**Event**: `mcp:write_document`

**Payload**:
```rust
#[derive(Serialize)]
pub struct WriteDocumentEvent {
    pub document_id: String,
    pub content: String,
}
```

**Event**: `mcp:insert_content`

**Payload**:
```rust
#[derive(Serialize)]
pub struct InsertContentEvent {
    pub document_id: String,
    pub text: String,
    pub position: InsertPosition,
}
```
