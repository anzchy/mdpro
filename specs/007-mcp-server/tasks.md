# Tasks: mdpro MCP Server

**Input**: Design documents from `/specs/007-mcp-server/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Not explicitly requested in specification. Manual integration testing with Claude Desktop.

**Organization**: Tasks grouped by user story for independent implementation.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1 (Read), US2 (Write), US3 (Multi-window)
- All paths are absolute from repository root

---

## Phase 1: Setup (Dependencies & Project Structure)

**Purpose**: Add new dependencies and prepare project structure

- [ ] T001 Add axum dependencies to src-tauri/Cargo.toml (axum 0.8, tower 0.5, tower-http 0.5)
- [ ] T002 [P] Add rmcp dependencies to src-tauri/Cargo.toml (rmcp 0.13, reqwest 0.11)
- [ ] T003 [P] Create src-tauri/src/bin/ directory for mdpro_mcp binary
- [ ] T004 Create MCP models module in src-tauri/src/models/mcp.rs with DocumentState, WindowState, ShadowStore structs
- [ ] T005 Register mcp module in src-tauri/src/models/mod.rs

---

## Phase 2: Foundational (HTTP Server & Shadow Store)

**Purpose**: Core infrastructure that MUST be complete before user stories

**⚠️ CRITICAL**: No MCP functionality can work until this phase is complete

- [ ] T006 Implement ShadowStore service in src-tauri/src/services/shadow_store.rs with thread-safe state management
- [ ] T007 Create mcp_sync_documents command in src-tauri/src/commands/mcp.rs for frontend → Rust sync
- [ ] T008 [P] Implement token generation and file writing (server.token, server.port) in src-tauri/src/services/http_server.rs
  - **IMPORTANT**: Set server.token file permissions to mode 600 (owner read/write only) for security
- [ ] T009 [P] Implement token validation middleware in src-tauri/src/services/http_server.rs
- [ ] T010 [P] Implement origin validation middleware in src-tauri/src/services/http_server.rs
- [ ] T011 Create axum router skeleton with middleware in src-tauri/src/services/http_server.rs
- [ ] T012 Integrate HTTP server startup in src-tauri/src/main.rs (spawn on app ready)
- [ ] T013 Register mcp commands in src-tauri/src/commands/mod.rs
- [ ] T014 Register shadow_store and http_server services in src-tauri/src/services/mod.rs
- [ ] T015 Add SharedShadowStore to Tauri managed state in src-tauri/src/main.rs

**Checkpoint**: HTTP server running on localhost with token auth. Shadow Store ready for sync.

---

## Phase 3: User Story 1 - Read Documents (Priority: P1) 🎯 MVP

**Goal**: MCP clients can list open documents and read their content

**Independent Test**:
1. Start mdpro with a document open
2. Call `GET /api/documents` → returns document list
3. Call `GET /api/documents/:id` → returns document content

### Implementation for User Story 1

- [ ] T016 [US1] Implement GET /api/status handler in src-tauri/src/services/http_server.rs
- [ ] T017 [US1] Implement GET /api/documents handler (list documents from Shadow Store) in src-tauri/src/services/http_server.rs
- [ ] T018 [US1] Implement GET /api/documents/:id handler (read single document) in src-tauri/src/services/http_server.rs
- [ ] T019 [US1] Create useMcpSync hook in src/hooks/useMcpSync.ts with 300ms debounce for content changes
- [ ] T020 [US1] Create mcpService.ts in src/services/mcpService.ts with invoke wrapper for mcp_sync_documents
- [ ] T021 [US1] Integrate useMcpSync hook in src/components/Editor/Editor.tsx
- [ ] T022 [US1] Add immediate sync triggers for document open/close/switch in useMcpSync.ts
- [ ] T023 [US1] Add MCP event logging in src-tauri/src/services/http_server.rs (mcp.read, mcp.list events)

**Checkpoint**: Can read documents via HTTP API. Frontend syncs state to Rust.

---

## Phase 4: User Story 2 - Write Documents (Priority: P2)

**Goal**: MCP clients can modify document content with user confirmation when backgrounded

**Independent Test**:
1. Start mdpro with document open, keep window focused
2. Call `POST /api/documents/:id` → content updated (no dialog)
3. Background mdpro window
4. Call `POST /api/documents/:id` → confirmation dialog appears

### Implementation for User Story 2

- [ ] T024 [US2] Implement POST /api/documents/:id handler (full content update) in src-tauri/src/services/http_server.rs
- [ ] T025 [US2] Implement POST /api/documents/:id/insert handler in src-tauri/src/services/http_server.rs
- [ ] T026 [US2] Implement POST /api/documents/new handler (create new document) in src-tauri/src/services/http_server.rs
- [ ] T027 [US2] Implement window focus check for auto-approve logic in src-tauri/src/services/http_server.rs
- [ ] T028 [US2] Implement confirmation dialog using rfd::MessageDialog in src-tauri/src/services/http_server.rs
- [ ] T029 [US2] Create useMcpEvents hook in src/hooks/useMcpEvents.ts to listen for mcp:write_document, mcp:insert_content
- [ ] T030 [US2] Integrate useMcpEvents hook in src/components/Editor/Editor.tsx
- [ ] T031 [US2] Add MCP write event logging (mcp.write, mcp.insert, mcp.confirm events)

**Checkpoint**: Full write functionality with conditional confirmation.

---

## Phase 5: User Story 3 - Multi-window Routing (Priority: P3)

**Goal**: MCP operations route to most recently focused window in multi-window scenarios

**Independent Test**:
1. Open two mdpro windows with different documents
2. Focus Window A, verify MCP reads/writes target Window A's documents
3. Focus Window B, verify MCP now targets Window B's documents

### Implementation for User Story 3

- [ ] T032 [US3] Add window focus tracking via WindowEvent::Focused in src-tauri/src/main.rs
- [ ] T033 [US3] Update ShadowStore to track focused_window and per-window documents in src-tauri/src/services/shadow_store.rs
- [ ] T034 [US3] Add window_label to SyncDocumentsPayload in frontend useMcpSync.ts
- [ ] T035 [US3] Implement window routing logic (focused → MRU → first) in src-tauri/src/services/http_server.rs
- [ ] T036 [US3] Add window label to mcp:write_document and mcp:insert_content events for correct targeting
- [ ] T037 [US3] Handle window close events to remove stale window state from ShadowStore

**Checkpoint**: Multi-window routing works correctly.

---

## Phase 6: MCP Server Binary (mdpro-mcp)

**Goal**: Standalone binary that Claude Code/Codex CLI can spawn as MCP server

**Independent Test**:
1. Start mdpro
2. Run `mdpro-mcp` directly, verify it connects and responds to MCP protocol

### Implementation

- [ ] T038 Create mdpro_mcp binary scaffold in src-tauri/src/bin/mdpro_mcp.rs
- [ ] T039 Implement config file reading (~/.mdpro/server.port, ~/.mdpro/server.token) in mdpro_mcp.rs
- [ ] T040 Implement get_open_documents MCP tool using rmcp #[tool] macro in mdpro_mcp.rs
- [ ] T041 Implement read_document MCP tool in mdpro_mcp.rs
- [ ] T042 Implement write_document MCP tool in mdpro_mcp.rs
- [ ] T043 Implement insert_content MCP tool in mdpro_mcp.rs
- [ ] T044 Implement mdpro://current/active resource in mdpro_mcp.rs
- [ ] T045 Add HTTP client (reqwest) for forwarding to mdpro HTTP server in mdpro_mcp.rs
- [ ] T046 Implement "mdpro not running" error handling in mdpro_mcp.rs
- [ ] T047 Add [[bin]] target for mdpro_mcp in src-tauri/Cargo.toml

**Checkpoint**: mdpro-mcp binary works as standalone MCP server.

---

## Phase 7: Polish & Integration

**Purpose**: Bundling, distribution, and final validation

- [ ] T048 Configure externalBin in src-tauri/tauri.conf.json to bundle mdpro-mcp with app
- [ ] T049 Add cleanup logic for server.port/server.token on app quit in src-tauri/src/main.rs
- [ ] T050 Create Claude Desktop MCP configuration example in specs/007-mcp-server/quickstart.md (already done, verify)
- [ ] T051 Manual integration test: Configure Claude Code with mdpro-mcp, test read document flow
  - **Verify**: Response time < 100ms for tool calls (per plan.md performance goals)
- [ ] T052 Manual integration test: Test write document with confirmation dialog
  - **Verify**: Response time < 100ms for tool calls (per plan.md performance goals)
- [ ] T053 Manual integration test: Test multi-window routing
  - **Verify**: Response time < 100ms for tool calls (per plan.md performance goals)
- [ ] T054 Update CHANGELOG.md with MCP Server feature

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies - start immediately
- **Phase 2 (Foundational)**: Depends on Phase 1 - BLOCKS all user stories
- **Phase 3 (US1 Read)**: Depends on Phase 2
- **Phase 4 (US2 Write)**: Depends on Phase 2, can run in parallel with US1
- **Phase 5 (US3 Multi-window)**: Depends on Phase 2, can run in parallel with US1/US2
- **Phase 6 (MCP Binary)**: Depends on Phase 2 (uses same HTTP API)
- **Phase 7 (Polish)**: Depends on Phases 3-6 completion

### User Story Independence

| Story | Depends On | Can Parallel With |
|-------|------------|-------------------|
| US1 (Read) | Foundational | - |
| US2 (Write) | Foundational | US1, US3 |
| US3 (Multi-window) | Foundational | US1, US2 |
| MCP Binary | Foundational | US1, US2, US3 |

### Within Each Phase

- T001-T005: T001 first (main deps), then T002-T005 in parallel
- T006-T015: T006 first (core store), then T007-T015 depend on models/store
- US phases: Model → Service → Handler → Frontend → Logging

### Parallel Opportunities

**Phase 1 (after T001)**:
```
T002, T003, T004, T005 can run in parallel
```

**Phase 2 (after T006)**:
```
T008, T009, T010 can run in parallel (middleware)
```

**After Phase 2 Completes**:
```
US1 (T016-T023), US2 (T024-T031), US3 (T032-T037), MCP Binary (T038-T047)
can all start in parallel with different team members
```

---

## Implementation Strategy

### MVP First (US1 Only)

1. Complete Phase 1: Setup (T001-T005)
2. Complete Phase 2: Foundational (T006-T015)
3. Complete Phase 3: US1 Read Documents (T016-T023)
4. Complete Phase 6: MCP Binary (T038-T047)
5. **STOP and VALIDATE**: Test with Claude Desktop - can read documents
6. Demo MVP: "Ask Claude what document is open in mdpro"

### Full Feature (All User Stories)

1. Setup → Foundational → US1 → MVP demo
2. Add US2 (Write) → Test confirmation flow
3. Add US3 (Multi-window) → Test routing
4. Polish → Full integration testing

---

## Notes

- All HTTP handlers read from ShadowStore (no direct frontend access)
- Frontend syncs to Rust; Rust serves HTTP; mdpro-mcp forwards MCP→HTTP
- Security: localhost only, token required, origin checked
- Debounce 300ms for content changes, immediate for structural changes
- Commit after each logical group (1-2 related tasks)
- MCP binary shares models with main app via Rust workspace
- **Constitution Compliance**: Update CHANGELOG.md after each logical commit group per constitution V
