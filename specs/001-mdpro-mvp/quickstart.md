# Quickstart Guide: mdpro MVP

**Branch**: `001-mdpro-mvp` | **Date**: 2026-01-17

## Prerequisites

### Required Software

| Software | Version | Installation |
|----------|---------|--------------|
| Rust | 1.75+ | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |
| Node.js | 20.x LTS | `brew install node@20` |
| pnpm | 8.x | `npm install -g pnpm` |
| Xcode CLT | Latest | `xcode-select --install` |

### macOS System Requirements

- macOS 13 (Ventura) or later
- Apple Silicon (ARM64) recommended
- 4GB RAM minimum

### Verify Installation

```bash
rustc --version    # Should show 1.75+
cargo --version    # Should show 1.75+
node --version     # Should show v20.x
pnpm --version     # Should show 8.x
```

---

## Project Setup

### 1. Clone Repository

```bash
git clone <repository-url>
cd mdpro
git checkout 001-mdpro-mvp
```

### 2. Install Dependencies

```bash
# Install frontend dependencies
pnpm install

# Install Tauri CLI (if not globally installed)
cargo install tauri-cli --version "^2.0"
```

### 3. Environment Setup

No `.env` file required for MVP (local-only app).

### 4. Start Development Server

```bash
# Start both frontend and Tauri in dev mode
pnpm tauri dev
```

This will:
1. Start Vite dev server on `http://localhost:1420`
2. Compile Rust backend
3. Launch mdpro app window

---

## Project Structure

```
mdpro/
├── src-tauri/                # Rust backend
│   ├── src/
│   │   ├── main.rs          # Entry point
│   │   ├── lib.rs           # Command exports
│   │   ├── commands/        # IPC handlers
│   │   ├── services/        # Business logic
│   │   └── models/          # Data structures
│   ├── Cargo.toml
│   └── tauri.conf.json
│
├── src/                      # React frontend
│   ├── components/          # UI components
│   ├── hooks/               # Custom hooks
│   ├── services/            # IPC wrappers
│   ├── stores/              # Zustand stores
│   ├── styles/              # CSS & themes
│   ├── types/               # TypeScript types
│   ├── App.tsx
│   └── main.tsx
│
├── tests/
│   ├── e2e/                 # Playwright tests
│   └── unit/                # Vitest tests
│
├── specs/                   # Feature specifications
│   └── 001-mdpro-mvp/
│
├── package.json
├── vite.config.ts
├── tailwind.config.js
└── tsconfig.json
```

---

## Development Commands

### Frontend

```bash
# Dev server only (no Tauri)
pnpm dev

# Build web bundle
pnpm build

# Preview production build
pnpm preview
```

### Backend (Rust)

```bash
cd src-tauri

# Check compilation
cargo check

# Run tests
cargo test

# Format
cargo fmt

# Lint
cargo clippy
```

### Full App

```bash
# Development mode
pnpm tauri dev

# Build for production
pnpm tauri build
```

---

## Initial Project Creation

If starting from scratch:

```bash
# Create Tauri + React + TypeScript project
pnpm create tauri-app mdpro --template react-ts

cd mdpro

# Add dependencies
pnpm add @uiw/react-codemirror @codemirror/lang-markdown @codemirror/commands
pnpm add @codemirror/language @codemirror/state @codemirror/view
pnpm add marked dompurify zustand highlight.js
pnpm add -D @types/dompurify tailwindcss postcss autoprefixer
pnpm add -D vitest @testing-library/react playwright

# Initialize Tailwind
pnpm exec tailwindcss init -p

# Add Rust dependencies (in src-tauri/Cargo.toml)
# pulldown-cmark = "0.10"
# notify = "6.1"
# serde_json = "1.0"
# chrono = "0.4"
# uuid = { version = "1.6", features = ["v4"] }
```

---

## Key Configuration Files

### `vite.config.ts`

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  envPrefix: ['VITE_', 'TAURI_'],
});
```

### `tailwind.config.js`

```javascript
/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        editor: {
          bg: 'var(--editor-bg)',
          text: 'var(--editor-text)',
        },
      },
    },
  },
  plugins: [],
};
```

### `src-tauri/tauri.conf.json` (key sections)

```json
{
  "productName": "mdpro",
  "version": "0.1.0",
  "identifier": "com.mdpro.app",
  "build": {
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [
      {
        "title": "mdpro",
        "width": 1200,
        "height": 800,
        "minWidth": 800,
        "minHeight": 600,
        "resizable": true,
        "fullscreen": false
      }
    ],
    "security": {
      "csp": "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'"
    }
  }
}
```

---

## Troubleshooting

### Common Issues

| Issue | Solution |
|------|----------|
| `cargo build` fails | Run `rustup update` |
| Tauri CLI not found | `cargo install tauri-cli --version "^2.0"` |
| Port 1420 in use | Kill process: `lsof -ti:1420 \| xargs kill` |
| WebView blank | Clear cache: `rm -rf ~/Library/WebKit/mdpro` |

### Debug Mode

```bash
# Enable Rust backtrace
RUST_BACKTRACE=1 pnpm tauri dev

# Enable debug logging
TAURI_DEBUG=1 pnpm tauri dev
```

### Xcode Issues

If you see code signing errors:
1. Open Xcode once and accept the license
2. Ensure you have a development team set up

---

## Next Steps

1. Review [spec.md](./spec.md) for feature requirements
2. Review [data-model.md](./data-model.md) for data structures
3. Review [contracts/](./contracts/) for IPC command definitions
4. Check [tasks.md](./tasks.md) for implementation tasks (after running `/speckit.tasks`)
