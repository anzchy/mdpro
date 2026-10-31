# Vendored tdd-guardian receipt engine

**This directory is the receipt engine that `scripts/tdd/red-receipt.mjs` runs.** It is a byte-identical copy of the
tdd-guardian plugin's `receipt.js` and its `lib/` closure, pinned here so RED receipts no longer depend on a plugin
cache ([#566](https://github.com/anzchy/mdpro/issues/566)). The entry never reads `~/.claude/plugins` or
`~/.codex/plugins`, and it has no fallback: a missing file, or one that does not load, stops it with an error naming
this directory.

- Source version: `0.10.2`
- Source path: `~/.claude/plugins/cache/xiaolai/tdd-guardian/0.10.2/scripts/tdd-guardian/` (plus that version's `LICENSE`),
  copied 2026-10-31 on the Mac mini. The 0.9.1 cache's closure was byte-identical, file for file.
- Upstream: https://github.com/xiaolai/tdd-guardian-for-claude (ISC, © 2026 Xiaolai Li; see `LICENSE`).
- `package.json` is mdpro's, not upstream's. The repo root declares `"type": "module"`, which would make these
  CommonJS files load as ES modules; the shim keeps them CommonJS.

## Files

Every file here except this README is listed with its SHA-256. `tests/tooling/t566-vendor-manifest.test.ts` fails on a
changed hash, a missing file or an unlisted one, and pins the same hashes as literals.

| File | SHA-256 |
|---|---|
| `receipt.js` | `ae42fb32b4e891c00fb0599401440931038d7aa76b05e6cc82a755fccd01f82d` |
| `lib/config.js` | `eab9862b8e2b372819ce19073dd9ee2009b232c16f835bc56adae337651cb9c5` |
| `lib/coverage.js` | `855ea57f4ee2be80242754b89b2fcaf62ae7847f50d9ae32112bc211d2d449a0` |
| `lib/exec.js` | `1ad0c9ecc746f5ff44ae315d647763d1f36a394bad00a74493e55b55b4f2b31a` |
| `lib/lanes.js` | `2d90bb0269799b78332b805c46f73cad51eb76ae1960f0ddef880a27b82e8892` |
| `lib/verification.js` | `7f6231c2067ec0c0e535118fd37b7667695e82ed558b62c9beed3e01cc95a951` |
| `LICENSE` | `87b3f4064cb76d1c7cc8c39546d7d62790b76372f37cfb9de1bb828a5f652b51` |
| `package.json` | `8005a3491db7d92f36ac66369861589f9c47123d3a7c71e643fc2c06168cd45a` |

## Local patches

Patch: not applied. `docs/reference/tdd-guardian-patches/tdd-guardian-0.9.1-exec-counts-and-exit101.patch` fixes two
holes in `lib/exec.js`, and the repo's lane wrappers keep the engine off both:

- **The Vitest count line with a `todo` segment.** The engine never sees Vitest's own summary. `scripts/tdd/unit-red-lane.mjs`
  writes Vitest's output to a log file and prints a single normalised `Tests  <f> failed | <p> passed (<t>)` line,
  which the unpatched parser reads. The `unit` and `slow` lanes are not receipt lanes for the entry.
- **Cargo's exit 101.** `scripts/cargo-test-lane.mjs` exits 1 when cargo exits 101 after a `test result: FAILED.`
  summary, which the unpatched `EXIT_CLASS` reads as a failure. A 101 with no FAILED summary (a build failure) still
  reaches the engine as 101 and is classed `runner-error`, which is the patch's intent for that case.

The manifest test proves both: it parses the normalised line with this `exec.js`, and it checks `classifyCargoExit`.
If either wrapper stops normalising, apply the patch here as a recorded change with its own RED.

## Upgrading

An upgrade is a reviewed diff of this directory, never a side effect of a plugin update. Copy the new version into a
new `tdd-guardian-<version>/`, remove this one, update the version named in `scripts/tdd/red-receipt.mjs`,
`scripts/ci/verify-inventory.mjs` and `tests/support/t566Engine.ts` (with its pinned hashes), and land it through the
normal audit. New evidence is stamped with the new version, so `evidence.json` entries recorded under the old one stop
matching their branch receipts: upgrade between items, never while a branch holds unsettled receipts.
