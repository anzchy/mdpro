---
description: Manual Testing Guide for mdpro
---

# Manual Testing Guide

Open the edge cases test file and help test mdpro features.

## Instructions

1. Read `tests/edge-cases-test.md` for the full test case list
2. Read `tests/20260312-mdpro-features-test-report.md` for current status
3. Run `pnpm dev` to open the browser dev server at http://localhost:1420/
4. For Tauri integration tests: `pnpm tauri dev`

## Test Categories (from edge-cases-test.md)

1. **A. Text Input & Cursor** — EC-INPUT-001 through EC-INPUT-012
2. **B. IME & Unicode** — EC-IME-001 through EC-IME-007
3. **C. Markdown Parsing** — EC-MD-001 through EC-MD-010
4. **D. Code Blocks** — EC-BLOCK-001 through EC-BLOCK-005
5. **E. TOC** — EC-TOC-001 through EC-TOC-008
6. **F. Lists** — EC-LIST-001 through EC-LIST-006
7. **G. Tables** — EC-TABLE-001 through EC-TABLE-010
8. **H. Links & Images** — EC-LINK/IMG-001 through EC-IMG-008
9. **I. Paste & Drag** — EC-PASTE/DRAG-001 through EC-DRAG-002
10. **J. File I/O** — EC-FILE-001 through EC-FILE-009
11. **K. Find & Replace** — EC-SEARCH-001 through EC-SEARCH-005
12. **L. Performance** — EC-PERF-001 through EC-PERF-006
13. **M. Security** — EC-SEC-001 through EC-SEC-006
14. **N. Accessibility** — EC-A11Y-001 through EC-A11Y-005
15. **O. Compatibility** — EC-COMP-001 through EC-COMP-004
