# Test Files

Test documents for validating mdpro markdown features.

## Folders

Automated tests sit at the root of `tests/` (app behaviour) or in `control/` (the launcher and `scripts/control`), `tooling/` (repo tooling: workflows, hooks, `scripts/{ci,ledger,lint,release,device}`) and `perf/` (the `pnpm perf:d12` heap harness). The rule that picks the folder is in `.claude/rules/10-tdd.md` § File placement (ADR-0098). The documents below are manual test inputs.

## Files

| File | Purpose |
|------|---------|
| `quick-test.md` | Minimal test for rapid feature verification |
| `edge-cases-test.md` | Comprehensive edge case coverage |

## Test Coverage

### TOC (Table of Contents)
- All heading levels (H1-H6)
- Duplicate headings (numeric suffix generation)
- Special characters, unicode, emojis
- Long headings (truncation/ellipsis)
- Nested hierarchy
- Headings with inline formatting

### Tables
- Basic tables
- Column alignment (left, center, right)
- Single row/column tables
- Empty cells
- Wide tables (many columns)
- Tall tables (50+ rows for performance)
- Formatted content in cells
- Special characters
- Escaped pipes

### Images
- Relative paths (`./assets/`)
- Absolute paths
- Remote URLs (HTTPS/HTTP)
- Missing/invalid images (error placeholder)
- Various formats (PNG, JPG, GIF, WebP, SVG)
- Alt text variations
- Images with titles
- Images in tables
- Data URLs

## Assets

```
test-files/
├── assets/
│   ├── test-image.png      # Valid test image
│   └── subfolder/deep/     # For path testing
├── quick-test.md
├── edge-cases-test.md
└── README.md
```

## Usage

1. Open `quick-test.md` for rapid testing
2. Open `edge-cases-test.md` for comprehensive testing
3. Use Cmd+Shift+B to toggle TOC sidebar
4. Right-click tables to test context menu
5. Drag/drop or paste images to test upload
