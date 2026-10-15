# 0102. v0.3.4 ships with a failing update check on Windows and Linux

## Status

Accepted, 2026-10-15. Decided by the user, who chose 「Ship 0.3.4, fix in 0.3.5 (Recommended)」
over 「Fix first, re-lock 0.3.4」 and 「Add Windows/Linux to latest.json」. The question was put by
mdpro-delegator after mdpro-codex-audit's Windows device check of the locked `3b16610` found
[D224](../plans/20260912-frontend-backend-sequencing-order.md#d224).

## Context

v0.3.4 exists to ship the Tauri 2.12.1 upgrade (ADR-0047 WI-004, `df2a879`) on its own. It was
locked at `3b16610`, and the macOS device check on that SHA passed
(`docs/test/20261015-v034-macos-device-check.md`).

The upgrade moved `tauri-plugin-updater` from 2.9.0 to 2.13.1. In 2.9.0 the updater looked up the
client's platform in `latest.json` only when the remote version was newer. In 2.13.1, `check()`
calls `get_urls()` (`updater.rs:675`) before it compares versions (`:677`), so a manifest with no
entry for the client's platform is an error even when there is nothing to update.

Our `latest.json` lists only `darwin-aarch64` and `darwin-x86_64`, by design: Windows and Linux are
optional platforms that are never put in it (`scripts/release/assetNames.mjs:34-37`). So on
Windows and Linux, Settings › About now shows "Couldn't get update information. Try again later."
every time it opens. On win-desktop: `ui.about.update_check` fail at 12:24:43, "None of the fallback
platforms [...] were found". 0.3.3 logged `success hasUpdate:false` there. That success was empty,
though: those platforms have never been offered an update. macOS is unaffected.

The release notes come from CHANGELOG at the locked ref (`scripts/release/latestJson.mjs`
`resolveNotes`), so no note can be added without moving the lock.

## Options considered

- **Ship 0.3.4 as locked, fix in 0.3.5 (chosen).** Keeps the passed macOS device check and the lock.
  Windows and Linux lose nothing they had: they never received updates. They only get an error
  message where they used to get a silent "no update".
- **Fix first, then re-lock 0.3.4.** Treat "no entry for this platform" as "no update" before
  release. Lost because it costs a fix, an audit and both device runs again, and all it prevents is
  a message, not a lost capability.
- **Put Windows and Linux entries in `latest.json`.** This would turn on real auto-updates for those
  platforms. That's a new feature with its own release-workflow change and signing, not a fix to
  make inside a locked release.

## Decision

v0.3.4 ships from `3b16610` with D224 as a known defect on Windows and Linux. The fix targets
v0.3.5: a missing platform entry when the remote version is not newer reads as "no update" (for
example through the updater's `version_comparator` or by handling `TargetsNotFound`), with a
regression test. The GitHub release body may carry a known-issue line, added after publishing and
only with the user's approval.

## Consequences

- Windows and Linux users of v0.3.4 see an update error in Settings › About until v0.3.5. Some will
  read it as a broken network or a broken app.
- The in-app release notes (`latest.json` notes) can't mention it, because they are fixed at the
  locked CHANGELOG.
- macOS updating, the only supported update path, is unaffected. The post-publish 0.3.3→0.3.4
  canary on the mini still runs.
- The 0.3.5 fix must not quietly enable Windows or Linux updates. That stays a separate decision.
