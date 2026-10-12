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
#
# Exits non-zero if `pnpm tauri build` fails, or if no DMG for this version was
# written by this run (a DMG left by an earlier build is rejected as stale,
# never deleted) — D182. Also (D183):
#   - rustc is checked with the other prerequisites;
#   - package.json's version must equal the one Tauri bundles with — the
#     `version` in src-tauri/tauri.conf.json (following it when it is a path to
#     a .json file), or, when that is absent, src-tauri/Cargo.toml's
#     [package] version (Tauri 2's fallback) — checked before install/build;
#   - of several fresh DMGs for the version, the newest by mtime is reported;
#   - mdpro.app counts only if a file in Contents/MacOS or its Info.plist was
#     written by this run; an older .app is rejected as stale.

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
command -v rustc >/dev/null 2>&1 || fail "rustc not found (install Rust via rustup)"
ok "pnpm $(pnpm --version)  |  rustc $(rustc --version | awk '{print $2}')  |  node $(node --version)"

# ── Version ───────────────────────────────────────────────────────────────────
VERSION=$(node -p "require('./package.json').version")
# The version Tauri names the DMG with (Tauri 2 config rules): tauri.conf.json's
# `version`, which may be a path (relative to src-tauri/) to a .json file
# holding one; without it, Cargo.toml's [package] version. Prints
# "<version>\t<source file>".
TAURI_VERSION_INFO=$(node -e '
  const fs = require("fs"), path = require("path");
  const dir = "src-tauri", conf = path.join(dir, "tauri.conf.json");
  const v = JSON.parse(fs.readFileSync(conf, "utf8")).version;
  if (typeof v === "string" && v.endsWith(".json")) {
    const f = path.join(dir, v);
    console.log(JSON.parse(fs.readFileSync(f, "utf8")).version + "\t" + f);
  } else if (typeof v === "string") {
    console.log(v + "\t" + conf);
  } else {
    const toml = path.join(dir, "Cargo.toml");
    const pkg = fs.readFileSync(toml, "utf8").split(/^\[/m).find((s) => s.startsWith("package]")) || "";
    const m = pkg.match(/^version\s*=\s*"([^"]+)"/m);
    console.log((m ? m[1] : "") + "\t" + toml);
  }
') || fail "could not read the Tauri version from src-tauri/"
TAURI_VERSION=${TAURI_VERSION_INFO%%$'\t'*}
TAURI_VERSION_SRC=${TAURI_VERSION_INFO#*$'\t'}
[ "$VERSION" = "$TAURI_VERSION" ] || \
  fail "version mismatch: package.json is $VERSION, $TAURI_VERSION_SRC is ${TAURI_VERSION:-<none>} — make them agree"
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
# Marker older than anything this build writes: the DMG must be newer than it,
# so a DMG left by an earlier build cannot pass as this run's output.
BUILD_MARKER=$(mktemp "${TMPDIR:-/tmp}/mdpro-build-mac.XXXXXX")
trap 'rm -f "$BUILD_MARKER"' EXIT

# The greps only drop blank lines and warning[ lines. Read each status from
# PIPESTATUS: tauri's decides success, and grep exiting 1 (every line filtered
# out) is not a failure.
set +e
pnpm tauri build 2>&1 | grep -v "^$" | grep -v "warning\["
BUILD_STATUS=("${PIPESTATUS[@]}")
set -e
[ "${BUILD_STATUS[0]}" -eq 0 ] || fail "pnpm tauri build failed (exit ${BUILD_STATUS[0]}) — check build output above"
for GREP_STATUS in "${BUILD_STATUS[1]}" "${BUILD_STATUS[2]}"; do
  [ "$GREP_STATUS" -le 1 ] || fail "build output filter failed (grep exit $GREP_STATUS)"
done

# ── Locate output ─────────────────────────────────────────────────────────────
DMG_DIR="$ROOT/src-tauri/target/release/bundle/dmg"
APP_DIR="$ROOT/src-tauri/target/release/bundle/macos"

[ -d "$DMG_DIR" ] || fail "DMG not found: $DMG_DIR does not exist — check build output above"
# Newest by mtime among this run's DMGs for the version; "<mtime> <path>"
# lines, so the cut keeps paths with spaces whole.
DMG=$(find "$DMG_DIR" -name "mdpro_${VERSION}_*.dmg" -newer "$BUILD_MARKER" -exec stat -f '%m %N' {} + \
  | sort -rn | head -1 | cut -d' ' -f2-)
APP="$APP_DIR/mdpro.app"

if [ ! -f "$DMG" ]; then
  if [ -n "$(find "$DMG_DIR" -name "mdpro_${VERSION}_*.dmg" | head -1)" ]; then
    fail "DMG for v$VERSION in $DMG_DIR is stale — not produced by this build"
  fi
  fail "DMG not found at $DMG_DIR — check build output above"
fi
[ -d "$APP" ] || fail "mdpro.app not found at $APP_DIR"
# The bundler rewrites the main binary and Info.plist; if neither is newer than
# the marker, this .app is left from an earlier build.
APP_FRESH=$(find "$APP/Contents/MacOS" "$APP/Contents/Info.plist" -newer "$BUILD_MARKER" 2>/dev/null | head -1 || true)
[ -n "$APP_FRESH" ] || fail "mdpro.app is stale — not produced by this build"

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
