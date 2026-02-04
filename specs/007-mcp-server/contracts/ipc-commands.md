# IPC Commands: mdpro MCP Server

New Tauri commands for MCP integration.

## Commands (Frontend → Rust)

### mcp_sync_documents

Sync document state from frontend to Rust Shadow Store.

**Handler**: `src-tauri/src/commands/mcp.rs`

```rust
#[tauri::command]
pub async fn mcp_sync_documents(
    state: State<'_, SharedShadowStore>,
    window: Window,
    payload: SyncDocumentsPayload,
) -> Result<(), String>
```

**Payload**:
```typescript
interface SyncDocumentsPayload {
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

**Trigger Points** (frontend):
| Event | Debounce | Location |
|-------|----------|----------|
| Content change | 300ms | `useAutoSave.ts` or dedicated hook |
| Document open | Immediate | `useDocument.openDocument()` |
| Document close | Immediate | `useDocument.closeDocument()` |
| Tab switch | Immediate | `tabStore.setActiveTab()` |

---

### mcp_get_server_info

Get HTTP server connection info for mdpro-mcp startup.

```rust
#[tauri::command]
pub fn mcp_get_server_info(
    state: State<'_, ServerConfig>,
) -> Result<ServerInfo, String>
```

**Response**:
```typescript
interface ServerInfo {
  port: number;
  token: string;
}
```

---

## Events (Rust → Frontend)

### mcp:write_document

Emitted when MCP client requests document write.

```rust
app.emit("mcp:write_document", WriteDocumentEvent {
    document_id: String,
    content: String,
})
```

**Frontend Handler** (`useMcpEvents.ts`):
```typescript
listen<WriteDocumentEvent>("mcp:write_document", (event) => {
  const { document_id, content } = event.payload;
  documentStore.updateDocumentContent(document_id, content);
});
```

---

### mcp:insert_content

Emitted when MCP client requests content insertion.

```rust
app.emit("mcp:insert_content", InsertContentEvent {
    document_id: String,
    text: String,
    position: InsertPosition,
})
```

**Frontend Handler**:
```typescript
listen<InsertContentEvent>("mcp:insert_content", (event) => {
  const { document_id, text, position } = event.payload;
  // Compute actual offset based on position
  editorRef.insertText(text, offset);
});
```

---

## State Management

### SharedShadowStore

Global Rust state managed via Tauri's state management.

**Registration** (`main.rs`):
```rust
.manage(Arc::new(Mutex::new(ShadowStore::default())))
```

**Access in handlers**:
```rust
state: State<'_, Arc<Mutex<ShadowStore>>>
```

---

## Window Focus Tracking

Track most recently focused window for MCP routing.

**Handler** (`main.rs`):
```rust
.on_window_event(|window, event| {
    if let WindowEvent::Focused(true) = event {
        if let Some(store) = window.try_state::<SharedShadowStore>() {
            let mut shadow = store.lock().unwrap();
            shadow.focused_window = Some(window.label().to_string());
        }
    }
})
```
