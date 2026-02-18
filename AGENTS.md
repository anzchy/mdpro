# Repository Guidelines

## Project Structure & Module Organization
- `src/` holds the React + TypeScript UI (entry in `src/main.tsx`, main component in `src/App.tsx`).
- `src-tauri/` contains the Rust backend, Tauri config (`src-tauri/tauri.conf.json`), and app icons.
- `public/` is for static assets served by Vite.
- `specs/` includes product docs and contracts; the active MVP spec is under `specs/001-mdpro-mvp/`.

## Build, Test, and Development Commands
- `npm run dev`: starts the Vite dev server for the web UI.
- `npm run build`: type-checks (`tsc`) and builds the production web bundle.
- `npm run preview`: serves the built web bundle locally.
- `npm run tauri dev`: runs the desktop app in development (requires Rust toolchain).
- `npm run tauri build`: produces a desktop app build via Tauri.

## Coding Style & Naming Conventions
- TypeScript/React uses 2-space indentation, double quotes, and semicolons (match existing files).
- Prefer functional React components with hooks; keep component files in `PascalCase` (e.g., `App.tsx`).
- Use `camelCase` for variables/functions, `PascalCase` for components/types, and `snake_case` in Rust.
- Keep UI styles in colocated CSS files (e.g., `src/App.css`) unless a component warrants its own file.

## Testing Guidelines
- Frontend tests use `Vitest` with `jsdom`.
- Install dependencies from project root: `npm install`.
- Run all frontend tests: `npm run test:run`.
- Run a specific test file in `tests/`: `npm run test:run -- tests/markdown-editor-core.test.ts`.
- Edge-case checklist lives in `tests/edge-cases-test.md` and should be used as regression coverage input.
- Rust backend tests run in `src-tauri/` via `cargo test`.
- Name test files consistently as `*.test.ts` / `*.test.tsx` under `tests/` (or feature-local test folders when needed).

## Commit & Pull Request Guidelines
- Commit messages are short, lowercase, and action-oriented (e.g., "init commit", "update 001 spec md files").
- PRs should include a clear summary, link to any relevant spec in `specs/`, and UI screenshots for visual changes.
- Call out any Tauri/Rust changes that affect permissions or capabilities.

## Configuration & Security Notes
- Tauri permissions/capabilities live in `src-tauri/capabilities/`; update them alongside feature work.
- Treat `src-tauri/tauri.conf.json` as the source of truth for bundling and app metadata.
