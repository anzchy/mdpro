---
name: release-gate
description: Run mdpro's release gates and summarize the results. Use when asked to run the full quality gates (tests, typecheck, build, coverage, Rust tests, ledger), verify readiness, or produce a gate report.
---

# Release Gate

## Overview
Run mdpro's gate commands in order and summarize the outcome. Every heavy command runs through
`scripts/heavy-lock.sh` (rule 10).

## Workflow
1) Confirm the current branch and dirty state (`git status -sb`).
2) Run the gates, in this order:
   - Unit tests: `scripts/heavy-lock.sh pnpm test:run`
   - Typecheck and build: `scripts/heavy-lock.sh sh -c 'pnpm -s typecheck:tests && pnpm -s build'`
   - Coverage: `scripts/heavy-lock.sh pnpm coverage`
   - Rust tests: `scripts/heavy-lock.sh node scripts/cargo-test-lane.mjs cargo test --manifest-path src-tauri/Cargo.toml`
   - Feature ledger: `pnpm ledger:check`
3) If a gate fails, capture the first error block and stop.
4) Report:
   - Which gates ran
   - Pass/fail status of each
   - Key errors and next actions

## Notes
- Run every gate unless asked for a subset.
- Do not run interactive dev servers, and not `pnpm test`, which starts vitest in watch mode.
