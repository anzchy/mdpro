# Quickstart: Verify Window & Table Features

**Feature**: 003-redesign-plugin-system
**Date**: 2026-01-23

## Overview

This guide walks through manual verification of the new window dragging, multi-window, and WYSIWYG table features.

## Setup

1. Start the app in development mode: `npm run tauri dev`
2. Open a Markdown file with a table (pipe syntax)

## Tests

### 1. Topbar Dragging

- Click and drag the topbar background.
- Confirm the window moves.
- Click any topbar controls (if present) and confirm they still work.

### 2. Multi-Window

- Use the app menu: **File → New Window**.
- Open a different Markdown file in the new window.
- Confirm view mode, sidebar, and edits are independent between windows.
- Close one window and confirm the other stays open.

### 3. WYSIWYG Tables

- Switch to WYSIWYG mode.
- Confirm the table renders with rows and columns.
- Edit cell text; switch back to source mode and confirm Markdown updates.

## Expected Results Checklist

- [ ] Topbar dragging moves the window.
- [ ] Interactive topbar elements still work.
- [ ] Two windows can be open simultaneously with independent state.
- [ ] Table syntax renders in WYSIWYG mode and edits persist.
