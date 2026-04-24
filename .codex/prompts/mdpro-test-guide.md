---
description: Manual testing guide for mdpro edge-case coverage.
---

# mdpro Manual Testing Guide

Read:

1. `tests/edge-cases-test.md`
2. `tests/20260312-mdpro-features-test-report.md`, if present

Run either:

```bash
pnpm dev
```

or, for Tauri integration:

```bash
pnpm tauri dev
```

Use these categories from the edge-case checklist:

1. Text input and cursor
2. IME and Unicode
3. Markdown parsing
4. Code blocks
5. TOC
6. Lists
7. Tables
8. Links and images
9. Paste and drag
10. File I/O
11. Find and replace
12. Performance
13. Security
14. Accessibility
15. Compatibility

Report tested cases with observed result, failure details, and reproduction steps.

