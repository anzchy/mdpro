# Changelog

All notable changes to mdpro will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Math / LaTeX rendering (Typora-parity Phase 1, WI-1.1): `$inline$` and `$$display$$` math now render. The canonical Rust renderer emits `.math-inline` / `.math-display` wrappers carrying raw TeX; the preview typesets them with bundled KaTeX (offline), failing soft on invalid TeX (raw source kept, never blank). HTML export pre-renders math to static KaTeX and inlines the KaTeX stylesheet, so exported files display math with zero JS. Math inside code spans/fences stays literal
- Footnotes (Typora-parity Phase 1, WI-1.3): `[^1]` references and definitions render with working return ("↩") back-links; the reference gets a stable `fnref-` anchor and the definition links back to it. Undefined references stay literal
- Auto-link + emoji (Typora-parity Phase 1, WI-1.4): bare `http(s)://` URLs are linkified, and a curated set of `:shortcode:` emoji render as glyphs. Both skip code spans/fences and existing links; unknown shortcodes stay literal
- In-app update checker: Settings → About page with version display, update check, download progress, and one-click install via `tauri-plugin-updater`
- Pre-relaunch save guard: automatically saves all modified documents before restarting, blocks if untitled docs exist or saves fail
- CI release workflow: `latest.json` generation with dynamic GitHub asset discovery via `jq`, signing env vars for updater artifacts

### Security
- Sanitizer policy redesign (Typora-parity Phase 0, WI-0.1): the Rust `sanitize_html` and frontend DOMPurify config now share one per-feature allow-list matrix that preserves legitimate KaTeX math, footnote anchors, and Mermaid inline-SVG output while neutralizing script/`on*`/`<foreignObject>`/`url(http…)`-in-style payloads on every render surface. `style` is never allowed (no exfiltration), href schemes are restricted to the safe set, and in-doc `#anchor` links pass through. Mirrored tag/attr lists are regression-tested on both surfaces
- Upgraded DOMPurify from `^3.2.7` to `^3.3.2` (resolved to `3.3.3`), patching GHSA-h8r8-wccr-v5f2 and GHSA-v2wj-7wpq-c8vv — both Moderate XSS CVEs affecting the HTML paste-sanitization path in the WYSIWYG editor

### Changed
- Encoding-safe save round-trip (Typora-parity Phase 0, WI-0.3): files opened as UTF-16LE/BE are now saved back in their original encoding (BOM preserved) instead of being silently rewritten as UTF-8. `save_file`/`save_file_dialog` accept the document's encoding; the open path detects encoding with a confidence level and refuses to guess (no blind Latin-1) for non-UTF-8 files with no BOM, surfacing an encoding error rather than corrupting content. CRLF line endings survive the round-trip
- ⌘/ now cycles view modes from any context, including when the CodeMirror source editor has focus. The line-comment shortcut moved from ⌘/ to ⌘⌥/ to free up the cycle binding (split via a `Prec.highest` keymap in `Editor.tsx`)

### Fixed
- Preferences write-through no longer fails silently (Typora-parity Phase 0, WI-0.5): `preferencesService.setPreferences()` now catches a disk-write rejection, surfaces a "Failed to save preferences" toast (one signal per surface), logs the failure, and re-throws so awaiting callers can react. Previously the many `void setPreferences(...)` fire-and-forget call sites lost the error entirely
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

## [0.3.0] - 2026-04-10

### Added
- **Two-mode editor** — ViewMode simplified to WYSIWYG (⌃4) and Source (⌃2); the old four-mode setup (split / editor-only / preview-only / wysiwyg) is retired. Stored preferences migrate automatically.
- **Inline source reveal** — in WYSIWYG mode, moving the cursor over a link, image, or code span reveals the raw Markdown inline. Press ⌃\` to force-reveal the element under the cursor on demand.
- **Draft migration** — legacy `~/.mdpro/drafts/` auto-save files migrate to the correct platform data directory on first launch.

### Fixed
- Cmd+S no longer causes a visible blink in the mode label (closes #377)
- Highlight toggle now works on existing selections in WYSIWYG mode (closes #376)
- Image src resolves immediately after paste; no more flash of broken image (closes #375)
- MCP `insert_content` checks window focus before injecting (closes #356)
- MCP shadow store rolls back on emit failure; rollback outcome now logged
- MCP insert panics on multi-byte (emoji/CJK) documents (closes #345)
- MCP `mcp_sync_documents` payload size enforced; `log_event` payload capped (closes #316)
- MCP TOML config path escaped correctly (closes #145)
- IPC commands `check_file_modified`, `reload_file`, `copy_external_image` validate paths (closes #351, #346, #266)
- HTML export sanitized with ammonia to prevent stored XSS (closes #246); heading IDs and task-list checkboxes preserved
- Split-view drag listeners cleaned up on unmount (closes #123)

### Changed
- Title bar row removed; mode label moved to the sidebar traffic-lights zone
- ⌃1 (Split) and ⌃3 (Preview Only) removed; ⌃2 now maps to Source

---

## [0.2.6] - 2026-04-02

### Added
- In-app update checker — Settings → About shows version, checks for updates, tracks download progress, and installs with one click

### Fixed
- File watcher no longer triggers on self-writes (closes #291)
- Stale closures eliminated in `useMcpEvents` (closes #284, #254)
- `save_file` validates file extension to prevent arbitrary writes (closes #279, #264, #245, #209)
- TOC heading parser handles CRLF line endings (closes #259)
- Auto-save reads active document ID from store instead of captured closure (closes #220)
- MCP server clears focused window on blur (closes #201)
- `export_html` theme param sanitized with allowlist (closes #193)

### Removed
- Dead `useMilkdown` hook (closes #239)
- Dead `getServerInfo()` from mcpService (closes #195)

---

## [0.2.5] - 2026-04-02

### Fixed
- Highlight and Export HTML shortcuts wired through preferences system (closes #207, #192)
- `dirs::home_dir()` replaces `env::var("HOME")` for portability (closes #176)
- Draft auto-save and deletion errors now logged instead of silently swallowed (closes #163)
- MCP binary path platform guard added for non-macOS builds (closes #185)
- Link modal callback guarded against destroyed editor view (closes #161)
- CRLF normalized before highlight preprocessing in CodeMirror (closes #182)

---

## [0.2.4] - 2026-03-31

### Added
- Settings panel redesigned with 9 sections (Editor, Markdown, Appearance, Export, Keyboard Shortcuts, Integrations, etc.)
- User-configurable keyboard shortcuts — bind any action in Preferences → Keyboard Shortcuts
- CodeMirror compartments for live preference reconfiguration (font size, line wrap, tab size)
- `==highlight==` syntax rendered in WYSIWYG mode (closes #40)
- React modal for ⌘K link insert, replacing `window.prompt` (closes #25)
- Atomic preferences writes with concurrent-save lock

### Fixed
- Settings panel label/control vertical misalignment (closes #78)
- ⌘/ view-cycle only intercepts when the editor is not focused (closes #32)
- Sidebar toggle shortcut documented and corrected to ⌘⇧L (closes #33)

---

## [0.2.3] - 2026-03-22

### Fixed
- ⌘1–6 heading shortcuts in Milkdown WYSIWYG mode (closes #37)
- Inline code and strikethrough keybindings restored (closes #36)
- ⌘0 paragraph shortcut uses `turnIntoTextCommand` correctly (closes #34)
- ⌘⇧H highlight routed to Milkdown command in WYSIWYG mode (closes #35)
- XSS, URL injection, path traversal, and token leak vulnerabilities patched
- TOC click-to-navigate restored in all view modes
- Stale-closure writes and cross-document dispatches guarded in editor store

---

## [0.2.2] - 2026-03-21

### Added
- Image paste into WYSIWYG editor (⌘V) — image saved to `assets/` folder beside the `.md` file, reference inserted automatically
- Find & Replace via ⌘F using CodeMirror search extension (closes #9)
- Drag-and-drop image files onto the editor inserts `![image](path)` (closes #12)

### Fixed
- YAML frontmatter stripped before rendering (closes #15)
- Pasted HTML sanitized; `javascript:` links blocked in WYSIWYG (closes #7, #10)
- Unicode-aware heading slugs for CJK characters and emoji (closes #8)
- CRLF line endings normalized on file read (closes #11)
- Milkdown listener wired to documentStore — fixes Cmd+S data loss after WYSIWYG edits
- Accessibility: DevToolbar `tabIndex=-1`, Escape closes dialogs (closes #13)

---

## [0.2.1] - 2026-02-04

### Added
- MCP Integrations settings panel — configure MCP server from inside the app

### Fixed
- MCP HTTP server stays alive between requests (shutdown sender now retained)
- TOC click-to-jump working in WYSIWYG mode
- MCP HTTP port hardcoded to 55045 for stability

---

## [0.2.0] - 2026-02-04

### Added
- **MCP (Model Context Protocol) server** — expose open documents to Claude Code, Codex CLI, and Gemini CLI. Tools: `get_open_documents`, `read_document`, `write_document`, `insert_content`. Server config at `~/.mdpro/server.port` and `~/.mdpro/server.token`.
- **Table of contents sidebar** — heading extraction via pulldown-cmark, click-to-navigate, scroll-spy highlighting.
- **Tab bar** — open multiple documents at once with configurable position, close behavior, and MRU tracking.
- **Bottom status bar** — mode tabs at the bottom of the editor window.
- Image service with base64 conversion for bundled assets.

---

## [0.1.8] - 2026-01-29

### Added
- Default view mode from preferences applied when opening files

### Fixed
- Windows close error

---

## [0.1.7] - 2026-01-29

### Added
- Structured JSONL logging to `~/.mdpro/mdpro.log` for debugging production builds

### Fixed
- WYSIWYG mode rendering issue

---

## [0.1.6] - 2026-01-25

### Added
- Multi-window support
- Table formatting in WYSIWYG editor
- Window state persistence across launches

---

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
