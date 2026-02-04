# Changelog

All notable changes to mdpro will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
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
