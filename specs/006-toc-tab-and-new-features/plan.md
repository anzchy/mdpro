# Implementation Plan: TOC Sidebar, Multi-Tab Support, and Editor Enhancements

**Branch**: `006-toc-tab-and-new-features` | **Date**: 2026-02-03 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/006-toc-tab-and-new-features/spec.md`

## Summary

This plan implements five interconnected features for mdpro: (1) TOC sidebar with spy scrolling and hierarchical navigation, (2) multi-tab document support with dirty state indicators and tab cycling, (3) streamlined auto-save with debounce, (4) enhanced table rendering with context menus, and (5) image rendering with drag-drop/paste support. The implementation leverages the existing Tauri 2.0 architecture with React frontend and Rust backend, extending Zustand stores for state management and adding new IPC commands for backend operations.

## Technical Context

**Language/Version**: TypeScript 5.8 (frontend), Rust 2021 Edition (backend)
**Primary Dependencies**: React 19, Tauri 2.0, CodeMirror 6, Milkdown 7.18, Zustand 4.5.4, Vite 7
**Storage**: Local filesystem via Tauri, JSON preferences file at `~/.mdpro/preferences.json`
**Testing**: Vitest (frontend unit), Playwright (E2E), cargo test (Rust backend)
**Target Platform**: macOS 13+, Apple Silicon (ARM64)
**Project Type**: Desktop application (Tauri = Rust backend + React frontend)
**Performance Goals**:
- TOC navigation: <2s to any section (SC-001)
- Tab switching: 10+ tabs without degradation (SC-002)
- Auto-save: 100% reliability within configured interval (SC-003)
- Table rendering: <500ms for 50 rows (SC-004)
- Image loading: local immediate, remote <100ms start (SC-005)
- Context menu actions: <200ms perceived time (SC-007)

**Constraints**:
- Local files only (no cloud sync)
- Max file size: 10MB
- macOS-only (no Windows/Linux)
- HTML export only (no PDF/Word)

**Scale/Scope**: Single-user desktop app, typical document size <1MB, up to 20 concurrent tabs

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| Existing Architecture | ✅ PASS | Extends existing Tauri/React/Zustand patterns |
| Local-First | ✅ PASS | All features work offline, local filesystem only |
| Simplicity | ✅ PASS | No new frameworks introduced, reuses existing stack |
| Performance | ✅ PASS | Success criteria defined per feature |

**Gate Status**: ✅ PASSED - Proceed to Phase 0

## Project Structure

### Documentation (this feature)

```text
specs/006-toc-tab-and-new-features/
├── spec.md              # Feature specification
├── plan.md              # This file
├── research.md          # Industry conventions and best practices
├── data-model.md        # Entity definitions
├── quickstart.md        # Implementation guide
├── contracts/           # IPC command contracts
│   ├── toc-commands.md
│   ├── tab-commands.md
│   ├── auto-save-commands.md
│   ├── table-commands.md
│   └── image-commands.md
├── diagrams/            # Visual documentation
│   ├── wireframe.html
│   ├── site-diagram.html
│   └── user-flow.html
└── tasks.md             # Implementation tasks (Phase 2)
```

### Source Code (repository root)

```text
src-tauri/                      # Rust backend (Tauri 2.0)
├── src/
│   ├── commands/
│   │   ├── toc.rs              # NEW: TOC extraction commands
│   │   ├── file.rs             # MODIFIED: silent save, auto-save config
│   │   └── image.rs            # NEW: Image upload/resolve commands
│   ├── services/
│   │   └── markdown.rs         # MODIFIED: heading extraction
│   └── models/
│       └── preferences.rs      # MODIFIED: auto-save, tab position settings

src/                            # React frontend
├── components/
│   ├── Sidebar/
│   │   ├── TOCSidebar.tsx      # NEW: Table of Contents component
│   │   └── index.tsx           # MODIFIED: toggle between views
│   ├── TabBar/
│   │   ├── TabBar.tsx          # NEW: Tab bar component
│   │   ├── Tab.tsx             # NEW: Individual tab component
│   │   └── index.ts
│   ├── Editor/
│   │   └── TableContextMenu.tsx # NEW: Table editing context menu
│   └── Settings/
│       └── ImageSettings.tsx    # NEW: Image configuration panel
├── hooks/
│   ├── useTOC.ts               # NEW: TOC extraction and spy scrolling
│   ├── useTabs.ts              # NEW: Tab management
│   ├── useAutoSave.ts          # MODIFIED: debounced auto-save
│   └── useImageUpload.ts       # NEW: Image handling
├── stores/
│   ├── tocStore.ts             # NEW: TOC state
│   ├── tabStore.ts             # NEW: Tab state
│   └── documentStore.ts        # MODIFIED: multi-document support
├── services/
│   ├── tocService.ts           # NEW: IPC wrappers for TOC
│   └── imageService.ts         # NEW: IPC wrappers for images
└── plugins/
    └── milkdown/
        └── tablePlugin.ts      # MODIFIED: context menu integration
```

**Structure Decision**: Follows existing mdpro architecture. New components are added to appropriate directories. No new top-level directories required.

## Feature Implementation Overview

### Feature 1: TOC Sidebar (FR-001 to FR-004)

**Approach**:
- Extract headings using Rust `pulldown-cmark` parser (backend)
- Store TOC state in new `tocStore` (Zustand)
- Implement spy scrolling with Intersection Observer API
- Toggle via existing sidebar mechanism (Cmd+Shift+B)

**Key Decisions from Research**:
- Use Intersection Observer with `rootMargin: "0px 0px -66%"` for spy scrolling
- Handle duplicate headings with numeric suffixes (e.g., `heading`, `heading-1`)
- Anchor IDs: lowercase, hyphens for spaces

### Feature 2: Multi-Tab Support (FR-005 to FR-009)

**Approach**:
- New `tabStore` manages tab state (id, documentId, dirty, order)
- Tab bar component with single-row layout, horizontal scroll for overflow
- Focus management: MRU (Most Recently Used) on close

**Key Decisions from Research**:
- Tab switch animation: 300ms cross-fade, no slide
- Preserve scroll position per tab (context preservation)
- Dirty indicator: filled circle replacing × when unsaved

### Feature 3: Auto-Save (FR-010 to FR-014)

**Approach**:
- Extend existing `useAutoSave` hook with debounce
- Add `saveInProgress` flag to prevent double-saves
- Silent save for existing files, Save As dialog for new files
- Configurable intervals: 5s, 15s, 60s, disabled

**Key Decisions from Research**:
- Debounce: 1500ms default (configurable)
- Hybrid approach: debounce + onBlur
- Non-blocking toast for errors

### Feature 4: Table Editing (FR-015 to FR-017)

**Approach**:
- Extend Milkdown table plugin with context menu
- Right-click triggers `TableContextMenu` component
- Alignment persists to Markdown syntax

**Key Decisions from Research**:
- Menu structure: Row ops → Column ops → divider → Alignment → divider → Delete
- Quick shortcut: Cmd+Enter for insert row below
- Tab in last cell creates new row

### Feature 5: Image Rendering (FR-018 to FR-022)

**Approach**:
- Resolve paths in Rust backend (relative to document)
- Image upload saves to configurable asset folder
- Drag-drop and paste support via frontend handlers

**Key Decisions from Research**:
- Default asset folder: `./assets/` relative to document
- Support multiple images at once
- Use HTML `<img>` when dimensions are explicitly set
- Error placeholder shows alt text + path

## Complexity Tracking

> No constitution violations to justify.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| N/A | N/A | N/A |

## Phase Summary

| Phase | Artifacts | Status |
|-------|-----------|--------|
| Phase 0 | research.md | ✅ Complete (updated with comparison findings) |
| Phase 1 | data-model.md, contracts/, quickstart.md | ✅ Complete |
| Phase 2 | tasks.md | ✅ Complete (103 tasks generated) |
