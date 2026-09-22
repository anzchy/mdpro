# Implementation Plan: mdpro MCP Server

**Branch**: `007-feat/mcp-server` | **Date**: 2026-02-04 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/007-mcp-server/spec.md`

## Summary

Enable Claude Code, Codex CLI, and Gemini CLI to interact with mdpro documents via the Model Context Protocol (MCP). Implements a "Sidecar + IPC" architecture: `mdpro-mcp` (Rust binary) acts as the MCP Server (stdio), forwarding requests to mdpro's internal HTTP API. A Shadow Store in Rust mirrors frontend document state for MCP access.

## Technical Context

**Language/Version**: TypeScript 5.8 (frontend), Rust 2021 Edition (backend)
**Primary Dependencies**:
- Existing: Tauri 2.0, React 19, Zustand 4, tokio
- New: axum 0.8, tower-http 0.5, rmcp 0.13, reqwest 0.11

**Storage**: Local filesystem, platform data dir `dirs::data_dir()/mdpro/` (macOS: `~/Library/Application Support/mdpro/`) for config (server.port, server.token)
**Testing**: cargo test (Rust), Vitest (frontend), manual integration with Claude Desktop
**Target Platform**: macOS 13+ (Apple Silicon)
**Project Type**: Desktop app (Tauri) with additional CLI binary
**Performance Goals**: Sub-100ms response time for MCP tool calls
**Constraints**: localhost only, no cloud, max 10MB document size (existing)
**Scale/Scope**: Single user, multiple windows, ~10 concurrent documents

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| V. Changelog Tracking | ✅ Pass | Will update CHANGELOG.md per commit |
| VI. Atomic Commits | ✅ Pass | Split by layer: Rust backend → IPC → Frontend sync → Integration |

**No violations requiring justification.**

## Project Structure

### Documentation (this feature)

```text
specs/007-mcp-server/
├── spec.md              # Feature specification (input)
├── plan.md              # This file
├── research.md          # Technology decisions (axum, rmcp, shadow store)
├── data-model.md        # Entity definitions and sync protocol
├── quickstart.md        # Developer setup guide
├── contracts/
│   ├── http-api.yaml    # OpenAPI spec for internal HTTP API
│   ├── mcp-tools.json   # MCP tool schemas
│   └── ipc-commands.md  # Tauri IPC command definitions
└── tasks.md             # Implementation tasks (next step: /speckit.tasks)
```

### Source Code (repository root)

```text
src-tauri/
├── src/
│   ├── commands/
│   │   └── mcp.rs           # NEW: mcp_sync_documents, mcp_get_server_info
│   ├── services/
│   │   ├── http_server.rs   # NEW: axum HTTP server
│   │   └── shadow_store.rs  # NEW: document state mirror
│   ├── models/
│   │   └── mcp.rs           # NEW: DocumentState, WindowState, ShadowStore
│   └── main.rs              # Modified: HTTP server startup, window focus tracking
├── src/bin/
│   └── mdpro_mcp.rs         # NEW: MCP Server binary (rmcp + reqwest)
└── Cargo.toml               # Modified: new dependencies

src/
├── hooks/
│   ├── useMcpSync.ts        # NEW: debounced sync to Shadow Store
│   └── useMcpEvents.ts      # NEW: listen for mcp:write_document, mcp:insert_content
├── services/
│   └── mcpService.ts        # NEW: invoke wrappers for mcp_* commands
└── components/
    └── Editor/
        └── Editor.tsx       # Modified: integrate useMcpSync hook
```

**Structure Decision**: Extends existing Tauri app structure. New `mdpro_mcp` binary is a separate Cargo binary target in the same workspace. No new top-level directories.

## Complexity Tracking

No constitution violations to justify. Design follows existing patterns:
- HTTP server uses same tokio runtime as Tauri
- IPC commands follow existing file.rs patterns
- Frontend hooks follow existing useMenuEvents pattern

## Phase Summary

| Phase | Deliverables | Status |
|-------|--------------|--------|
| Phase 0 | research.md | ✅ Complete |
| Phase 1 | data-model.md, contracts/, quickstart.md | ✅ Complete |
| Phase 2 | tasks.md | Pending: run `/speckit.tasks` |

## Key Decisions from Research

1. **HTTP Framework**: axum (official Tokio ecosystem, Tower middleware)
2. **MCP SDK**: rmcp (official Anthropic SDK, production-ready)
3. **State Sync**: Frontend as source of truth, Rust mirrors via `invoke("mcp_sync_documents")`
4. **Write Confirmation**: Auto-approve if focused, native dialog if backgrounded
5. **Error Handling**: Return structured MCP errors, fail fast if mdpro not running

## Next Step

Run `/speckit.tasks` to generate implementation tasks from this plan.
