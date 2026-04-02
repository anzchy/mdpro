# Changelog

All notable changes to mdpro will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- In-app update checker: Settings → About page with version display, update check, download progress, and one-click install via `tauri-plugin-updater`
- Pre-relaunch save guard: automatically saves all modified documents before restarting, blocks if untitled docs exist or saves fail
- CI release workflow: `latest.json` generation with dynamic GitHub asset discovery via `jq`, signing env vars for updater artifacts

### Security
- Upgraded DOMPurify from `^3.2.7` to `^3.3.2` (resolved to `3.3.3`), patching GHSA-h8r8-wccr-v5f2 and GHSA-v2wj-7wpq-c8vv — both Moderate XSS CVEs affecting the HTML paste-sanitization path in the WYSIWYG editor

### Fixed
- Settings panel label/control vertical misalignment — `.settings-row-content` was missing `flex: 1` (preventing `space-between` from distributing width) and had `align-items: flex-start` instead of `center`, causing controls to top-align rather than vertically centre next to labels
- TOC click-to-navigate broken in all view modes
  - `editor-only`: `preview-container` was absent from the DOM, so `scrollToHeading` returned immediately with no effect
  - `split`: only the preview pane scrolled; the CodeMirror editor pane did not
  - All modes using CodeMirror: DOM-based heading search is fundamentally incompatible with CodeMirror's plain-text rendering — headings have no `<h1>`–`<h6>` elements in the editor pane
  - Fix: `useTOC` now accepts `viewMode`; for `editor-only` and `split`, navigation uses `EditorView.scrollIntoView` targeting the heading's line number (stored in `TOCEntry.lineNumber`)
- Heading anchor ID mismatch between Rust renderer and JS TOC parser
  - `markdown.rs` replaced each non-alphanumeric character individually (e.g. `. ` → `--`), while the JS algorithm collapses runs to a single `-` (e.g. `. ` → `-`), causing `data-heading-id` selectors to fail for headings like `"1. Introduction"`
  - Fix: `markdown.rs::generate_heading_id` now uses run-based collapsing, matching `tocService.ts` and the existing `commands/toc.rs` logic

### Added
- MCP (Model Context Protocol) Server for LLM integration
  - HTTP API server with token authentication (localhost only)
  - Shadow Store for syncing document state from frontend to Rust
  - `mdpro_mcp` binary for Claude Code, Codex CLI, and Gemini CLI integration
  - Tools: get_open_documents, read_document, write_document, insert_content
  - Write confirmation dialog when mdpro is not focused
  - Multi-window routing based on most recently focused window
  - Server config files at `~/.mdpro/server.port` and `~/.mdpro/server.token`
  - Quickstart guide at `specs/007-mcp-server/quickstart.md`
- TOC store (`src/stores/tocStore.ts`) with TOCEntry, TOCState interfaces and Zustand store
- Tab store (`src/stores/tabStore.ts`) with Tab, TabState, ClosedTab interfaces and MRU logic
- TOC service (`src/services/tocService.ts`) with IPC wrappers and frontend heading parser
- Image service (`src/services/imageService.ts`) with all interfaces and IPC wrappers
- Rust TOC commands (`src-tauri/src/commands/toc.rs`) with pulldown-cmark parser for heading extraction
- Rust image commands (`src-tauri/src/commands/image.rs`) for resolve, upload, batch upload, copy external
- AutoSaveConfig, TabBarConfig, ImageConfig structs in preferences.rs
- Multi-document support methods in documentStore (getDocumentById, setActiveDocument, getActiveDocument, getDocumentByPath)
- useTOC hook (`src/hooks/useTOC.ts`) with Intersection Observer for spy scrolling
- TOCSidebar component (`src/components/Sidebar/TOCSidebar.tsx`) with hierarchical rendering
- SidebarContainer component (`src/components/Sidebar/index.tsx`) for toggling between file list and TOC views
- Tab component (`src/components/TabBar/Tab.tsx`) with dirty indicator and middle-click close
- TabBar component (`src/components/TabBar/TabBar.tsx`) with horizontal scroll and new tab button
- CSS styles for TabBar and TOCSidebar components
- base64 dependency to Cargo.toml for image upload support
- Project constitution with changelog tracking rule (`.specify/memory/constitution.md`)

### Changed
- Extended UserPreferences schema to include autoSave, tabBar, and image configuration sections
- Updated `src-tauri/src/commands/mod.rs` to register toc and image command modules
- Updated `src-tauri/src/models/mod.rs` to export new config types

## [0.1.5] - 2026-02-03

### Added
- Use default view mode from preferences for file opens (a3a8a5f)

### Fixed
- Windows close error (ee9eb79)

### Changed
- Automate version update in release workflow (601909e)

## [0.1.4] - 2026-02-02

### Fixed
- WYSIWYG mode rendering issue (aaf3c48)

### Added
- Structured JSONL logging for debugging (d5051bc)
