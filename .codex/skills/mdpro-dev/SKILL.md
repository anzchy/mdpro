---
name: mdpro-dev
description: Use when implementing, debugging, or reviewing mdpro code, especially Tauri IPC, MCP, Milkdown/CodeMirror editors, Zustand stores, logging, TDD, keyboard shortcuts, or version sync.
---

# mdpro Development

This is the Codex-local import of the useful `.claude/rules` and project-specific dev skills. Use it as a navigation layer, then load only the relevant reference file.

## First Steps

1. Run `git status -sb` before changing files.
2. Read `AGENTS.md`, `CLAUDE.md`, and the specific source files involved.
3. Keep diffs focused. Do not refactor surrounding code unless required for correctness.
4. Do not commit unless the user explicitly asks.

## Reference Selection

- For general project rules, TDD patterns, review checklist, version sync, keyboard shortcuts, and comments: read `references/project-rules.md`.
- For Tauri commands, events, dialogs, file watching, lifecycle, and Rust logging: read `references/tauri.md`.
- For MCP server, shadow store, HTTP API, token auth, and MCP tool changes: read `references/mcp.md`.
- For Milkdown WYSIWYG, ProseMirror commands, content sync, and editor plugins: read `references/milkdown.md`.

## Core Rules

- Write regression tests first for bug fixes and behavior changes unless the change is CSS-only, docs-only, or type-only.
- Use Zustand selectors in React components. Use `useXStore.getState()` inside callbacks and event handlers.
- New Tauri commands must return `Result<T, String>`, log Start plus Success or Fail, and be registered in capabilities when needed.
- TypeScript logging uses `loggingService.logEventSync()`. Rust logging uses `logger::log_event()`. Do not commit `console.log`, `println!`, or `eprintln!`.
- New store files need tests. Bug fixes need tests that would have caught the bug.
- Keep source files around 300 lines; split types, helpers, subcomponents, or hooks when a file grows.
- Use CSS variables for colors. Plugin styles stay in colocated plugin CSS files.

## Verification

- Always run `pnpm build` after code changes.
- Run `pnpm test:run` when tests were added, touched, or the change affects tested behavior.
- Run `cd src-tauri && cargo check` when Rust files changed.
- For risky UI flows, verify through browser/Tauri/manual steps and report exactly what was checked.

