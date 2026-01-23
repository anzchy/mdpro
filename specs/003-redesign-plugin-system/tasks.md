# Implementation Tasks: Window Dragging, Multi-Window Docs, WYSIWYG Tables

**Feature**: 003-redesign-plugin-system
**Generated**: 2026-01-23
**Source**: [spec.md](./spec.md) | [plan.md](./plan.md)

## Overview

Tasks organized by feature area. Each task includes:
- `[P]` = Prerequisite
- Dependencies where applicable

## Phase 1: Topbar Dragging (P1)

- [ ] T001 [P] Audit existing topbar markup and styles
- [ ] T002 Apply drag region attributes to non-interactive topbar elements
- [ ] T003 Ensure interactive topbar controls are excluded from drag region
- [ ] T004 Verify dragging works in all view modes

## Phase 2: Multi-Window Support (P1)

- [ ] T010 [P] Add "New Window" menu item in Tauri menu
- [ ] T011 Add frontend window service to create new windows
- [ ] T012 Wire menu event to open a new window from the UI
- [ ] T013 Support "open file in new window" via menu/event payload
- [ ] T014 Verify window titles reflect per-window active document
- [ ] T015 Confirm independent state between windows (view mode, sidebar)
- [ ] T016 Validate file watcher reload prompt when same file opens in two windows

## Phase 3: WYSIWYG Tables (P1)

- [ ] T020 [P] Enable GFM/table preset in Milkdown configuration
- [ ] T021 Confirm Markdown table renders in WYSIWYG mode
- [ ] T022 Confirm table edits persist back to Markdown source
- [ ] T023 Validate tables with alignment markers and empty cells

## Phase 4: Validation & Cleanup

- [ ] T030 Manual regression sweep for open/save/close flows
- [ ] T031 Update documentation or comments if behavior changes

## Task Summary

| Phase | Tasks | Priority |
|-------|-------|----------|
| Topbar Dragging | T001-T004 | P1 |
| Multi-Window | T010-T016 | P1 |
| WYSIWYG Tables | T020-T023 | P1 |
| Validation | T030-T031 | P2 |

**Total Tasks**: 19
