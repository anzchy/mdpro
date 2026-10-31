# W036b: v0.3.6 Windows menu batch rerun, stopped by the driver (2026-10-31)

**Build:** the installed `build-windows.yml` run 40658985158 build (`head_sha` `8aeb1c19…`), not reinstalled.
`D:\programs\mdpro\tauri-app.exe` 0.3.5, SHA-256 `1C46E3F2…B7818FC81` before and after; both launches
`app.ready.releaseId = 0.3.5-dev@8aeb1c1956643146a6e7762f16307dbb054ddad2`. App code unchanged to master `6f6d3e35`
(`git diff 8aeb1c19 6f6d3e35 -- src src-tauri` deletes only `src-tauri/.claude/tdd-guardian/*`).
**Driver:** master `6f6d3e35`, which carries the D336–D338 fix `571f0d08`; `deploy.sh` exit 0 with matching hashes.
**Tester:** gpt-auditor in a device pane, brief `~/.mdpro-redesign/device/brief-W036b.md`, report
`~/.mdpro-redesign/device/W036b-report.md`. Host key `SHA256:XGEIP0iWtBBw9XQgnKaK1nmOMHQuU/xxfqQRw/TnfzA` matched.
**Clearances, quoted (user, 2026-10-31):** 「Nothing unsaved, restart (Recommended)」; de-DE 「Allow, restore after
(Recommended)」 (not used: the run stopped before any language step).

## Result

Every card is **NOT EXERCISED**: D261, MENU-D261-WI-1, MENU-M3a, MENU-M7 (remainder), D255-windows, D264. The R-5
layout-scope measurement was not made. No product PASS or FAIL comes from this run. D50 was not in scope.

The first native call (`max`, `wait`, `windows` in `mdpro.sh debug --yes`) exited 2 at step 0 with
`ERROR UI: UI_BUDGET_INVALID`, `OUTCOME status=failed phase="setup: UI_BUDGET_INVALID" inputOutcome=none
heldInput=released cleanup=not-started completedSteps=0`. A read-only `windows` call, with a longer transaction budget
and run directly through `ui-run.ps1`, stopped the same way. No input was sent.

## Delegator check

- **Cause, reproduced on the Mac in pwsh:** `ui-run.ps1:14-17` assigns `Read-NativeInteger`'s results back to
  `[string]` parameters, so the checks at `:26-27` compare strings; the Mac always sends `-PollMs 25`, and
  `"25" -gt 1000` is true (`function f([string]$PollMs){ $PollMs = [long]25; $PollMs -gt 1000 }` → `True`, type `String`).
  The driver tests used `PollMs` 1, 10 and 1000, which compare correctly as strings. Registered as
  [D342](../plans/20260912-frontend-backend-sequencing-order.md#d342), escape #5 in `docs/audit/escapes.md`.
- **Cleanup proved:** `.mdpro` restored from `snap\W036b` with the config hash equal to the snapshot
  (`322D9900…D59C92C8`); language list equal to the export (de-DE never added); the ten fixture copies removed; one
  `tauri-app` process, port 9222 closed, no `mdpro-audit-*` task. Final maximize not proved (the same driver stop).
  `snap\W036b` is left on the PC, with the older `snap\W036` untouched.

## Next

D342 fix (gpt-imple-1, over-cap grant G-D342-1), then rerun W036b from a fresh snapshot.
