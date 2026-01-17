# mdpro

A local Markdown editor built with Tauri 2 + React + TypeScript.

## File Structure

```
.
|-- src/                 # React UI
|   |-- components/      # UI components (Editor, Toolbar, etc.)
|   |-- hooks/           # Custom hooks (useDocument, shortcuts, etc.)
|   |-- services/        # Tauri IPC wrappers
|   |-- stores/          # Zustand state stores
|   |-- styles/          # Global + theme styles
|   `-- types/           # Shared TypeScript types
|-- src-tauri/           # Rust backend (Tauri)
|   `-- src/
|       |-- commands/    # IPC commands (file, export, etc.)
|       |-- models/      # Data models
|       `-- services/    # Backend services
|-- specs/001-mdpro-mvp/ # Product spec, plan, and tasks
|-- public/              # Static assets
`-- package.json
```

## How to Use

Prerequisites:
- Node.js + pnpm
- Rust toolchain (stable)
- Tauri CLI (installed via devDependencies)

Common commands:
- `pnpm install`: install JS dependencies
- `pnpm dev`: run the Vite web dev server
- `pnpm build`: build the web bundle (type-check + Vite build)
- `pnpm tauri dev`: run the desktop app (uses Vite in the background)
- `pnpm tauri build`: build a desktop app bundle

## How to Test

Tests are not wired yet. When added:
- Frontend: `pnpm test` (Vitest)
- Backend: `cargo test` in `src-tauri/`
- E2E: `pnpm playwright test`

## Shipping DMG via GitHub Actions

This repo ships macOS DMG files on tag pushes using `.github/workflows/release.yml`.

Steps:
1. Commit and push your changes.
2. Create a version tag (example):
   - `git tag v0.1.1`
   - `git push origin v0.1.1`
3. GitHub Actions builds on `macos-latest` and publishes a GitHub Release with the DMG attached.

Notes:
- The workflow only runs on tags that match `v*`.
- The bundle targets in `src-tauri/tauri.conf.json` must include `dmg` and `app`.
- For public distribution, add signing/notarization later (not configured yet).

## Release Checklist

- Update version numbers (`src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`).
- Run `pnpm tauri build` locally to sanity-check.
- Push commits to `main` or `master`.
- Tag a release (example):
  - `git tag v0.1.1`
  - `git push origin v0.1.1`
- Verify the GitHub Release assets include the `.dmg` and `.app`.

## macOS Signing and Notarization (CI)

Tauri can sign and notarize on GitHub Actions using environment variables. Add these
GitHub repository secrets and the workflow will use them if present.

Required for signing:
- `APPLE_CERTIFICATE`: base64 of your `.p12` signing certificate.
- `APPLE_CERTIFICATE_PASSWORD`: password for the `.p12` file.
- `APPLE_SIGNING_IDENTITY`: certificate name shown by `security find-identity -v -p codesigning`.

Required for notarization (choose one option):
1) Apple ID:
   - `APPLE_ID`
   - `APPLE_PASSWORD` (app-specific password)
   - `APPLE_TEAM_ID`
2) App Store Connect API key:
   - `APPLE_API_ISSUER`
   - `APPLE_API_KEY`
   - `APPLE_API_KEY_P8` (base64 of the `.p8` key file)

Notes:
- Notarization is required for Developer ID distribution.
- Secrets are referenced in `.github/workflows/release.yml`.

## Troubleshooting

- **Tauri build fails**: ensure Rust toolchain is installed (`rustup show`) and `pnpm install` has run.
- **Window doesn't open**: make sure `pnpm tauri dev` is used (not just `pnpm dev`).
- **File dialogs not working**: confirm native dialog permissions (macOS Security & Privacy).
- **IPC errors**: verify commands are registered in `src-tauri/src/commands/mod.rs` and `src-tauri/src/main.rs`.
- **Type errors after dependency changes**: delete `node_modules`, re-run `pnpm install`.

## Recommended IDE Setup

- VS Code + Tauri + rust-analyzer
