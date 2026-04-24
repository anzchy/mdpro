---
description: Rewrite rough mdpro task text into a concise actionable coding prompt.
argument-hint: "[rough task text]"
---

# Refine mdpro Prompt

Rewrite the user's text as a clear, actionable prompt for a coding assistant. Output only the revised prompt.

Rules:

- Use imperative voice.
- Keep technical terms exactly as given: Milkdown, ProseMirror, CodeMirror, Zustand, Tauri, Rust, rmcp, axum, pulldown-cmark, DOMPurify, marked, MCP.
- Preserve file paths, component names, function names, Tauri command names, and Rust struct names verbatim.
- If the input mentions a UI area, map it to the correct mdpro domain:
  - WYSIWYG editor -> Milkdown / ProseMirror (`src/components/Editor/MilkdownEditor.tsx`)
  - Source editor -> CodeMirror 6 (`src/components/Editor/Editor.tsx`)
  - Split view -> `SplitView` (`src/components/Editor/SplitView.tsx`)
  - Preview pane -> `Preview` (`src/components/Preview/Preview.tsx`)
  - TOC sidebar -> `TOCSidebar` (`src/components/Sidebar/`)
  - Bottom tabs -> `BottomTabs` (`src/components/BottomTabs/`)
  - Settings -> `SettingsDialog` (`src/components/common/SettingsDialog.tsx`)
  - Rust backend -> `src-tauri/src/commands/` or `src-tauri/src/services/`
  - MCP server -> `src-tauri/src/bin/mdpro_mcp.rs` or `src-tauri/src/services/http_server.rs`
- If the input is in Chinese, translate to English while keeping code identifiers untranslated.
- Remove filler, hedging, and politeness fluff.
- Keep the prompt to one to three sentences.
- Do not add requirements the user did not mention.

