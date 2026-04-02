# mdpro Audit Findings

## Run: 2026-03-31 00:00
Dimensions checked: [3 — IPC trust boundaries, 4 — Rust backend safety, 9 — Plugin CSS isolation, 14 — Dead code, 17 — Version file sync]

### [BLOCK] IPC trust boundaries: Panic on malformed Markdown byte offset in TOC extraction

**File**: `src-tauri/src/commands/toc.rs` (line 108)
**Impact**: The `extract_headings()` function uses byte offsets from the Markdown parser to index into the content string via `content[..start_offset]` without bounds validation. If the parser returns an offset beyond the string length (possible with corrupt/unusual UTF-8 input), this will panic and crash the app. Reachable from the `get_document_headings` Tauri command (line 128).
**Fix**: Add a bounds check before the slice: `if start_offset > content.len() { return default; }`, or use `content.get(..start_offset)` with a fallback.

### [BLOCK] IPC trust boundaries: Filename sanitization logic error allows path-traversal filenames

**File**: `src-tauri/src/commands/image.rs` (line 276–279)
**Impact**: The filename filter `.filter(|n| !n.is_empty() && !n.starts_with('.') || n.len() > 1)` has an operator-precedence bug. It evaluates as `(!empty && !dot) || (len > 1)`, which accepts dangerous filenames like `..`, `.bashrc`, `.env`, etc. because `len > 1` is true. This defeats the stated goal of preventing path-traversal filenames in uploaded images, potentially allowing writes of hidden/dotfiles in the asset directory.
**Fix**: Add parentheses to fix precedence: `.filter(|n| !n.is_empty() && (!n.starts_with('.') || n.len() > 1))` — or better, explicitly reject names that are all dots or start with a dot.

### [BLOCK] Rust backend safety: panic!() in application entry point on init failure

**File**: `src-tauri/src/main.rs` (line 417)
**Impact**: `panic!("error while building tauri application")` will crash the process ungracefully if Tauri app initialization fails. While the error is logged on lines 409–416, the panic terminates without cleanup. On macOS this surfaces as an opaque crash report to users.
**Fix**: Replace `panic!(...)` with `std::process::exit(1)` after logging, or propagate the error via `main() -> Result<(), Box<dyn Error>>`.

### [MUST] IPC trust boundaries: Unvalidated directory creation from frontend-supplied paths

**File**: `src-tauri/src/commands/file.rs` (line 385–403)
**Impact**: `save_file()` calls `std::fs::create_dir_all(parent)` on a `PathBuf` constructed directly from user input without path validation. A compromised or malicious frontend could supply absolute paths targeting system directories. OS permissions limit the blast radius, but the command should enforce an allowlist or canonical-path check.
**Fix**: Validate that the resolved path is within an allowed directory (e.g., the user's home or project root) before creating directories.

### [MUST] Plugin CSS isolation: Hardcoded white/color values break dark theme

**File**: `src/styles/globals.css` (lines 694, 1148, 1312, 1502)
**Impact**: Hardcoded `#fff` and `white` on `.toolbar-button--primary`, `.toolbar-button.primary`, `.toggle-slider:before`, and `.dev-toolbar-button` bypass the CSS variable theming system. These elements will be invisible or unreadable in dark mode.
**Fix**: Replace hardcoded values with `var(--color-text)` or an appropriate theme variable (e.g., `var(--color-bg)` for the toggle slider dot).

### [MUST] Plugin CSS isolation: Hardcoded accent color on hover states ignores theme

**File**: `src/styles/globals.css` (lines 699, 1153)
**Impact**: Hardcoded `#1d4ed8` on `.toolbar-button--primary:hover` and `.toolbar-button.primary:hover` forces a specific blue regardless of theme configuration, overriding the `--color-accent` CSS variable system. This creates visual inconsistency when users select a different accent color.
**Fix**: Replace with `background: var(--color-accent)` or a derived darker shade.

### [SHOULD] IPC trust boundaries: Image upload accepts hidden/dotfiles

**File**: `src-tauri/src/commands/image.rs` (line 276–283)
**Impact**: Related to the BLOCK-level sanitization bug — even with corrected precedence, multi-character dotfiles like `.env`, `.git`, `.htaccess` are accepted. If the asset folder is within the project tree, this enables configuration-file injection.
**Fix**: Explicitly reject filenames starting with `.` in the upload path.

### [SHOULD] Plugin CSS isolation: No semantic CSS variables for error/warning/success colors

**File**: `src/styles/globals.css` (lines 1162–1192, 1338, 1446, 1486, 1501)
**Impact**: Hardcoded `#dc2626` (red), `#16a34a` (green), `#f59e0b` (amber) for status states are not themeable, creating inconsistent appearance across light/dark modes.
**Fix**: Define `--color-error`, `--color-success`, `--color-warning` CSS variables in the theme root and use them.

### [SHOULD] Plugin CSS isolation: Hardcoded rgba overlays won't adapt to dark mode

**File**: `src/styles/globals.css` (lines 625, 1031–1032, 1654)
**Impact**: Dialog backdrops, dirty banners, and tab shadows use hardcoded rgba values that assume a light theme background.
**Fix**: Move to CSS variables like `--shadow-color`, `--overlay-bg`.

### [SHOULD] Plugin CSS isolation: Unscoped global `a` selector

**File**: `src/styles/globals.css` (line 58)
**Impact**: Bare `a { color: inherit; text-decoration: none; }` affects all link elements globally, including any third-party or dynamic content.
**Fix**: Scope under a parent class, e.g., `.editor-shell a`.

### [SHOULD] Plugin CSS isolation: App.css contains unused template boilerplate with hardcoded colors

**File**: `src/App.css` (lines 1–116)
**Impact**: Entire file uses hardcoded hex colors from Vite/React template that don't use the theme system. Likely dead code.
**Fix**: Remove if unused, or refactor to use mdpro CSS variables.

### [NOTE] IPC trust boundaries: Hardcoded developer path in MCP binary lookup

**File**: `src-tauri/src/commands/mcp.rs` (line 170–175)
**Impact**: Developer-specific absolute paths to debug/release binaries are hardcoded. Not a security issue but should be removed for production.
**Fix**: Remove the dev path fallback or gate it behind `#[cfg(debug_assertions)]`.

### [NOTE] Dead code: Unused TYPORA_KEYMAP_CONFIG export

**File**: `src/plugins/milkdown/typoraKeymapPlugin.ts` (line 118)
**Impact**: Exported constant intended for unit testing, but no test files exist for this module. Minor dead code.
**Fix**: Remove export or add corresponding tests.

### [NOTE] Plugin CSS isolation: !important overrides suggest specificity issues

**File**: `src/styles/globals.css` (line 1574), `src/components/BottomTabs/BottomTabs.css` (line 114)
**Impact**: `!important` flags make future overrides harder and indicate cascading problems.
**Fix**: Refactor selectors for proper specificity.

### ✓ Version file sync: All versions in sync at 0.2.4

`package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml` all report version `0.2.4`. No action needed.
