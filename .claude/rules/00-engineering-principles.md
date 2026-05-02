---
description: Top-level engineering principles — keep diffs focused, no store destructuring, files under 300 lines.
---

# 00 - Engineering Principles (Local)

Follow the shared rules in `AGENTS.md`.
Also follow the project-specific rules in `CLAUDE.md`.

Key points:
- Read before editing; keep diffs focused.
- No Zustand store destructuring in components.
- Prefer `useXStore.getState()` inside callbacks.
- Keep features local; avoid cross-feature imports unless shared.
- Keep code files under ~300 lines.
