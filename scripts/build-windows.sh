#!/usr/bin/env bash
# scripts/build-windows.sh
#
# Trigger a Windows NSIS installer build via GitHub Actions and download
# the result when it finishes.
#
# Usage:
#   pnpm build:windows              # build current package.json version
#   pnpm build:windows 0.2.4       # build a specific version
#   pnpm build:windows --help

set -euo pipefail

# ── helpers ────────────────────────────────────────────────────────────────────
info()  { printf '\033[34m[windows]\033[0m %s\n' "$*"; }
ok()    { printf '\033[32m[windows]\033[0m %s\n' "$*"; }
err()   { printf '\033[31m[windows]\033[0m %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<EOF
Usage: pnpm build:windows [VERSION]

  Build the mdpro Windows NSIS installer via GitHub Actions and download
  the resulting .exe when the run completes.

  VERSION   Optional semver string (e.g. 0.2.4).
            Defaults to the version in package.json.

Examples:
  pnpm build:windows            # use package.json version
  pnpm build:windows 0.3.0     # override version
EOF
  exit 0
}

# ── parse args ────────────────────────────────────────────────────────────────
VERSION=""
for arg in "$@"; do
  case "$arg" in
    --help|-h) usage ;;
    --*)       err "Unknown flag: $arg" ;;
    *)         VERSION="$arg" ;;
  esac
done

# ── pre-flight ────────────────────────────────────────────────────────────────
command -v gh  &>/dev/null || err "'gh' CLI not found. Install: https://cli.github.com"
gh auth status &>/dev/null || err "Not authenticated. Run: gh auth login"

REPO=$(gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null) \
  || err "Not inside a GitHub repository (or gh can't detect it)"

WORKFLOW="build-windows.yml"

# ── trigger ───────────────────────────────────────────────────────────────────
if [ -n "$VERSION" ]; then
  info "Triggering Windows build for version $VERSION on $REPO …"
  gh workflow run "$WORKFLOW" --repo "$REPO" --ref master \
    --field "version=$VERSION"
else
  info "Triggering Windows build (version from package.json) on $REPO …"
  gh workflow run "$WORKFLOW" --repo "$REPO" --ref master
fi

# Give GitHub a moment to register the run
sleep 4

# ── find the run ──────────────────────────────────────────────────────────────
RUN_ID=$(gh run list \
  --repo "$REPO" \
  --workflow "$WORKFLOW" \
  --limit 1 \
  --json databaseId \
  --jq '.[0].databaseId')

[ -n "$RUN_ID" ] || err "Could not find the workflow run. Check: https://github.com/$REPO/actions"

info "Run started → https://github.com/$REPO/actions/runs/$RUN_ID"
info "Waiting for build to finish (this takes ~10–15 minutes) …"

# ── wait ──────────────────────────────────────────────────────────────────────
if ! gh run watch "$RUN_ID" --repo "$REPO" --exit-status; then
  err "Build failed. See logs: https://github.com/$REPO/actions/runs/$RUN_ID"
fi

# ── download ──────────────────────────────────────────────────────────────────
OUT_DIR="dist-windows"
rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

info "Downloading NSIS installer …"
gh run download "$RUN_ID" --repo "$REPO" --dir "$OUT_DIR"

ok "Done! Installer saved to:"
find "$OUT_DIR" -name "*.exe" | while read -r f; do
  printf '  %s\n' "$f"
done
