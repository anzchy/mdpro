#!/usr/bin/env bash
# build-mac.sh — Build mdpro.app + DMG for macOS (Apple Silicon)
#
# Usage:
#   ./scripts/build-mac.sh              # full build (tests → frontend → Tauri)
#   ./scripts/build-mac.sh --skip-tests # skip test suite (faster iteration)
#   ./scripts/build-mac.sh --open       # open Finder at output after build
#   ./scripts/build-mac.sh --skip-tests --open
#
# Output:
#   src-tauri/target/release/bundle/dmg/mdpro_<version>_aarch64.dmg
#   src-tauri/target/release/bundle/macos/mdpro.app

set -euo pipefail

# ── Colours ──────────────────────────────────────────────────────────────────
BOLD=$'\e[1m'; RESET=$'\e[0m'
GREEN=$'\e[32m'; RED=$'\e[31m'; CYAN=$'\e[36m'; DIM=$'\e[2m'

step()  { echo ""; echo "${BOLD}${CYAN}▶ $*${RESET}"; }
ok()    { echo "${GREEN}✔ $*${RESET}"; }
fail()  { echo "${RED}✘ $*${RESET}"; exit 1; }
dim()   { echo "${DIM}$*${RESET}"; }

# ── Args ──────────────────────────────────────────────────────────────────────
SKIP_TESTS=false
OPEN_FINDER=false
for arg in "$@"; do
  case "$arg" in
    --skip-tests) SKIP_TESTS=true ;;
    --open)       OPEN_FINDER=true ;;
    *) echo "Unknown flag: $arg"; echo "Usage: $0 [--skip-tests] [--open]"; exit 1 ;;
  esac
done

# ── Root ──────────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

START_TIME=$(date +%s)

echo ""
echo "${BOLD}mdpro — macOS build${RESET}"
dim "$(date '+%Y-%m-%d %H:%M:%S')  root: $ROOT"

# ── Prereqs ───────────────────────────────────────────────────────────────────
step "Checking prerequisites"
command -v pnpm  >/dev/null 2>&1 || fail "pnpm not found (brew install pnpm)"
command -v cargo >/dev/null 2>&1 || fail "cargo not found (install Rust via rustup)"
command -v node  >/dev/null 2>&1 || fail "node not found"
ok "pnpm $(pnpm --version)  |  rustc $(rustc --version | awk '{print $2}')  |  node $(node --version)"

# ── Version ───────────────────────────────────────────────────────────────────
VERSION=$(node -p "require('./package.json').version")
dim "Building version: v$VERSION"

# ── Install deps ─────────────────────────────────────────────────────────────
step "Installing dependencies"
pnpm install --frozen-lockfile
ok "Dependencies up to date"

# ── Tests ────────────────────────────────────────────────────────────────────
if [ "$SKIP_TESTS" = false ]; then
  step "Running frontend tests"
  pnpm test:run || fail "Frontend tests failed — fix before building"
  ok "Frontend tests passed"

  step "Running Rust tests"
  cargo test --manifest-path src-tauri/Cargo.toml --quiet || fail "Rust tests failed — fix before building"
  ok "Rust tests passed"
else
  echo ""
  echo "${DIM}⚠ Tests skipped (--skip-tests)${RESET}"
fi

# ── Rust check ───────────────────────────────────────────────────────────────
step "Checking Rust compilation"
cargo check --manifest-path src-tauri/Cargo.toml --quiet || fail "cargo check failed"
ok "Rust compiles cleanly"

# ── Tauri build ───────────────────────────────────────────────────────────────
step "Building mdpro.app (this takes a few minutes)"
dim "pnpm tauri build  →  tsc + vite build + cargo release + bundle"
pnpm tauri build 2>&1 | grep -v "^$" | grep -v "warning\[" || true

# ── Locate output ─────────────────────────────────────────────────────────────
DMG_DIR="$ROOT/src-tauri/target/release/bundle/dmg"
APP_DIR="$ROOT/src-tauri/target/release/bundle/macos"

DMG=$(find "$DMG_DIR" -name "mdpro_${VERSION}_*.dmg" | head -1)
APP="$APP_DIR/mdpro.app"

[ -f "$DMG" ] || fail "DMG not found at $DMG_DIR — check build output above"
[ -d "$APP" ] || fail "mdpro.app not found at $APP_DIR"

# ── Done ─────────────────────────────────────────────────────────────────────
END_TIME=$(date +%s)
ELAPSED=$(( END_TIME - START_TIME ))
MINS=$(( ELAPSED / 60 ))
SECS=$(( ELAPSED % 60 ))

echo ""
echo "${BOLD}${GREEN}✔ Build complete in ${MINS}m ${SECS}s${RESET}"
echo ""
echo "  ${BOLD}DMG${RESET}  $DMG"
echo "  ${BOLD}App${RESET}  $APP"
echo ""
dim "Install:  open \"$DMG\""
dim "Verify:   codesign -dv --verbose \"$APP\" 2>&1 | grep Authority"

if [ "$OPEN_FINDER" = true ]; then
  open "$DMG_DIR"
fi
