# 0070. 0.3.1 ships without Developer ID signing or notarization

**Status**: Accepted (2026-10-10). User's words: 「0.3.1 不做，写明安装方式
(Recommended)」.

## Context

Codex reviewed the 0.3.1 release plan (job `review-plan-mv1rdnmo-honca8`,
NEEDS REVISION). Among its findings: `.github/workflows/release.yml` imports
the updater signing secrets but no Apple certificate, signing identity or
notarization credentials. "Confirm the signing key" in the plan meant only
the updater key. A local launch proves nothing about a browser-downloaded,
quarantined bundle, which Gatekeeper blocks unless it is notarized.

Every release so far (through 0.2.6) shipped this way. Notarizing needs an
Apple Developer account and certificate, signing the bundled `mdpro_mcp`
sidecar too, and new workflow steps. Meanwhile 0.2.x users are stranded on
0.2.6 by the empty v0.3.0 release ([D76](../plans/20260912-frontend-backend-sequencing-order.md#d76)),
and 0.3.1 already carries a long blocker list
([#release-031-gate](../plans/20260912-frontend-backend-sequencing-order.md#release-031-gate)).

## Decision

0.3.1 ships unsigned and unnotarized, as earlier releases did.

- The release notes give the install route that gets past Gatekeeper.
- Before publishing, someone downloads the release through a browser on a
  machine that has never run mdpro, installs it, and launches it, following
  those notes.
- The updater signing key stays the one embedded since 0.2.6
  (`tauri.conf.json` `pubkey`). It is not rotated, so historical clients can
  verify 0.3.1.

Notarization is a separate item for a later release. It is not in 0.3.1's gate.

## Consequences

- First installs keep the Gatekeeper warning and a manual override step.
  Some users will stop there; it also looks less trustworthy than a notarized
  app.
- Updates installed through the in-app updater are verified by the updater
  signature, not by Apple. Nothing changes for existing users who update in
  place.
- The browser-download check is manual and runs once per release. If the
  release notes and the macOS version diverge (Apple has tightened the
  override path before), the check is what catches it.
- Adding notarization later changes `release.yml` again and needs the
  sidecar signed. That work is deferred, not avoided.
