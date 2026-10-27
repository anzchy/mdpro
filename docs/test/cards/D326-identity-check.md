# D326 device identity check

**Controlling AC:** [D326](../../plans/20260912-frontend-backend-sequencing-order.md#d326), AC-5 in the implementor brief.

## Setup

- Use the Mac mini GUI lock and a standard, feature-off app bundle built from the branch head with `MDPRO_RELEASE_ID=<version>-dev@<40-character SHA>` (`pnpm tauri build --bundles app`). Do not use the ADR-0047 `control:build --profile verify` bundle, whose startup guard requires `control:launch`.
- Record that exact release id as `EXPECTED_RELEASE_ID`; use a copy of a Markdown fixture outside the repository.
- Keep the installed `/Applications/mdpro.app` closed for the first run. Preserve its prior state and restore it after the card.

## Steps

1. Run `pnpm device:identity --bundle "$VERIFY_BUNDLE" --file "$FIXTURE" --expected-release-id "$EXPECTED_RELEASE_ID" --out "$SCRATCHPAD/d326-identity.txt"`.
2. Capture stdout, exit status, and the report file. All four checks must say PASS, exit must be 0, and report bytes must equal stdout.
3. Keep the verified app running, then start `/Applications/mdpro.app` with `open -n` and confirm that both main processes exist. If macOS or single-instance routing prevents coexistence, record AC-5 as unverified rather than treating a one-process check as proof.
4. Run `pnpm device:identity --bundle "$VERIFY_BUNDLE" --expected-release-id "$EXPECTED_RELEASE_ID" --check-only --out "$SCRATCHPAD/d326-identity.txt"`. With both processes alive, `process` must say FAIL, `window` must say SKIPPED, and exit must be non-zero. The report file must describe this current failing run, not the prior PASS.
5. Close the verified app through its normal UI, keep the installed app running, and repeat step 1. The prelaunch check must refuse to open another app, report `process` FAIL, and exit non-zero.
6. Restore the installed app's prior running state and release the GUI lock.

## Failure condition

Any incorrect bundle, process, release id, or window verdict fails the card. An `IN PROGRESS` report means the command was interrupted and supplies no result. A second command using the same `--out` while one is running prints FAIL on stdout and leaves the first command's archive untouched; wait for it to finish or choose a different path. Do not use the launch for any feature test unless step 2 passed.
