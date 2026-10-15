# 0101. Macs on macOS 13.0 can be updated to a build they cannot open

**Status**: Accepted (2026-10-15). The user decided, relayed by mdpro-delegator:
「Accept, note it (Recommended)」.

## Context

Plan P WI-3.4 raises mdpro's minimum macOS from Tauri's default (10.13, because
`tauri.conf.json` set no `bundle.macOS.minimumSystemVersion`) to 13.1, as decision
E1 required (`docs/plans/20260911-ui-redesign/decisions.md`). macOS 13.1 is the
first release whose bundled WebKit (Safari 16.2) has `color-mix()`, and every
derived theme token since WI-3.1 depends on it. The build then carries
`LSMinimumSystemVersion` 13.1 in its `Info.plist`. On 13.0, Finder refuses to
open it ("You can't use this version of the application with this version of
macOS").

E1 settled the floor but not the update path. The in-app updater
(`tauri-plugin-updater`, endpoint `releases/latest/download/latest.json`) offers a
release by version alone. As we understand the plugin and the `latest.json` format,
there is no per-platform minimum-OS field and no check of the new bundle's
`LSMinimumSystemVersion` before it is installed. So a Mac still on 13.0 that runs
an older mdpro would be offered the new release, install it in place, and then be
unable to open mdpro.

The exposure is small. 13.0 → 13.1 is a free minor update that macOS offers
automatically, and 13.0 shipped in October 2022. It is not zero, though, and
updating in place replaces the copy that still works.

## Options considered

- **A. Accept and note it (chosen).** State "macOS 13.1 or later" in the CHANGELOG
  and the release notes, and record the recovery here.
- **B. Gate it in `latest.json`.** Keep 13.0 users off the new release, either
  with a separate feed or by leaving the platform entry out for them. The feed is
  one static file per release with no OS dimension, so this means a second
  endpoint chosen by OS version at runtime. That changes the updater
  configuration and the release workflow (ADR-0073) for a population that is
  probably empty. Rejected for now.
- **C. Check in the app before installing.** Read the OS version in the running
  (old) app and refuse the update on 13.0. That only helps builds that already
  carry the check, and the builds a 13.0 user runs today do not. It would protect
  the *next* floor raise, not this one. Rejected for this decision; it can come
  back when the floor next moves.
- **D. A `@supports` fallback, keeping the floor at 13.0.** E1 already rejected
  this: every derived token would need a second, hand-mixed value.

## Decision

A. WI-3.4 raises the floor to 13.1 and says so in the CHANGELOG ("Requires macOS
13.1 or later") and in the release notes of the first release that carries it. The
updater is unchanged.

## Consequences

- A Mac on 13.0 that accepts the update ends up with an mdpro that does not open.
  Recovery: update macOS to 13.1 or later, or reinstall the last pre-13.1 mdpro
  from GitHub Releases. Nothing in the app tells the user; the release notes are
  the only notice.
- No data is at risk. Documents and `~/.mdpro` are untouched, and drafts stay
  recoverable once mdpro opens again.
- The updater keeps no record of a minimum OS. The next time the floor moves, the
  same gap reopens unless option C is built first. That cost is carried forward,
  not paid.
- Support burden: a report of "mdpro won't open after updating" on macOS 13.0 has
  this as its answer.
