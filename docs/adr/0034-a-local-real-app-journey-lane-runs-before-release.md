# 0034. A local real-app journey lane runs before release, beside gui-acceptance

## Status

**Proposed** (2026-09-24). Kept out of D29 because it adds a dependency and a
new lane.

**Corrected in place while Proposed** (2026-09-24). An independent review
(Codex, thread `01a0d1fa…`, verdict *accept with changes*) prompted these
fixes:

- the security boundary and the release-artifact check;
- the separate single-instance route;
- a release-profile build;
- how E39, ADR-0020 and ADR-0032 are cited;
- the length.

**Amended in place while Proposed** (2026-10-02). ADR-0047 (Proposed)
decides the control channel this lane drives the app through. Four parts of
this record now point there instead of deciding the matter twice:

- decision 2's spike order;
- decision 3's "one Cargo feature";
- decision 4's security conditions;
- decision 6's log path.

The lane, its first journeys and its place on the release checklist are
unchanged. ADR-0047 and its plan do not deliver them.

**Relation to ADR-0032.** ADR-0032 decided that one obligation, the preference
round trip, is checked by hand, and it asked to be superseded if that proved
wrong. If this record is accepted **and** the preference journey lands:

- this record supersedes ADR-0032;
- ADR-0032's status line changes to *Superseded by ADR-0034*, and its body
  stays as written.

ADR-0017 and ADR-0018 say "no integration or e2e lane". That was true when
they were written, and they are not edited.

## Context

**The repo has two automated test lanes, and neither runs the app.**
`.claude/tdd-guardian/config.json` defines `unit` (vitest/jsdom) and `rust`
(`cargo test`).

**Runtime behaviour is checked by hand**, through the `gui-acceptance` skill.
That covers:

- window routing;
- the real IPC payloads;
- persistence through disk.

**The manual lane works, but it has limits:**

- It found D29.
- It does not protect the future. ADR-0032 names this as its real price.
- It has produced a false FAIL: a stale running process, on 2026-09-20
  (`gui-acceptance` §3).
- It keeps growing: D29 adds seven checks.

**Tauri's JS mocks cannot model `emit_to`.** The D29 planner and executor are
pure and tested, but the real delivery path is not.

**Peer survey, second-hand (2026-09-24):**

- vmark (Tauri) runs 38 journeys, weekly on Linux, through a debug-only
  `tauri-plugin-mcp-bridge`.
- MarkText runs Playwright on every PR.
- MiaoYan has no end-to-end lane.
- None of them automates macOS.
- `tauri-driver` does not support macOS.

**Constraints:**

- E39 forbids timing thresholds as blocking gates.
- A lane that drives the app needs a bundle identity, so it builds a `.app`,
  which takes minutes.

## Decision

1. **Add an `app` lane of real-app journeys that runs locally.** Running it
   before each release tag is an item on the release checklist, not an
   enforced gate. It is not in CI and it gates no commit.
   - It has one command, for example `pnpm test:app`.
   - Its verdict table goes in `docs/test/` and is linked from the release
     row.
2. **Pick the driver with a time-boxed spike, and add no dependency before
   it.** The candidates, their order and the screens are in ADR-0047
   decisions 4 and 5. `tauri-plugin-mcp-bridge` was first in line here until
   2026-10-02; it is not a candidate while its hijacking issue (#36) is
   open. The spike must still show three things:
   - it drives a packaged `.app` on macOS 13+ on Apple Silicon;
   - it can address windows by label;
   - its conditional registration does not reorder or bypass
     `tauri-plugin-single-instance` or the `RunEvent::Opened` handling.

   The chosen driver then gets its own dependency ADR.
3. **The build under test is a release-profile bundle.** It is not a debug
   build. It differs from the shipped build only in the ways ADR-0047
   decision 3 and its costs list: a verification packaging profile, the
   isolation behaviour, and the driver, all off in the shipped build.
4. **The control surface is treated as an attack surface.** ADR-0047
   decision 6 states the conditions for each transport, and a driver that
   cannot meet every one of them is rejected. In short:
   - it uses a dedicated, short-lived credential, never `server.token`;
   - an HTTP listener is on loopback only, with strict Host and Origin
     checks and no wildcard CORS;
   - it exposes only narrowly scoped endpoints;
   - any Tauri permissions it needs sit in a separate capability file that
     exists only in the feature build, never in `capabilities/default.json`,
     which already covers `main` and `mdpro-*`.

   The lane checks that the release build is clean in three layers, and
   ADR-0047 adds an attempted runtime activation as a fourth:
   - the default feature graph resolves without the driver crate;
   - the `dist` built for release contains no driver assets;
   - a probe against the release bundle finds no driver endpoint.

   Searching the Mach-O is not a check: frontend assets are embedded
   compressed (`gui-acceptance` §3).
5. **Each entry route gets its own journey.**
   - `open -a <absolute bundle path> <file>` sent to a running instance
     exercises `RunEvent::Opened`, the Finder route.
   - Launching a second process with the path exercises the single-instance
     callback. One journey is never counted as covering both routes.
   - Every run first proves it is a fresh process, with a marker in the log
     at launch (`gui-acceptance` trap 3).
6. **Journeys assert on state and logs, never on pixels.** State means
   window labels, the active document and the dirty flag. Logs mean byte-offset
   slices of the run's `mdpro.log`. In an isolated run (ADR-0047 decision 3)
   that file is in the run directory, not in `~/.mdpro`.
7. **The first journeys:**
   - D29 on the Finder route;
   - D29 on the single-instance route;
   - D29 with two windows, where the dirty one wins;
   - D20 G1;
   - the ADR-0032 preference round trip.

   `gui-acceptance` keeps the checks a script cannot judge: geometry, theme,
   paint and focus rings.

## Alternatives rejected

- **Manual checks only (the status quo).** Nothing guards against
  regressions.
- **Tests against Tauri's mock runtime.** They never touch Launch Services,
  the real `emit_to`, or the webview.
- **Native macOS UI automation (AppleScript, XCUITest).** It needs a
  UI-scripting grant and drives pixels, not state. It would repeat
  `gui-acceptance` more slowly.

## Consequences

- **Gives:** routing, quit and persistence checks that can be repeated before
  each release. A regression like D24 or D29 fails a script instead of
  waiting for someone to remember a row.
- **Costs:**
  - **It is still not the shipped binary.** The packaging profile, the
    isolation behaviour and the plugin set differ (ADR-0047). A defect that
    only shows without them still needs `gui-acceptance` on the shipped
    bundle.
  - **It is not per-commit.** A regression can sit until the next release
    run.
  - **It adds a new control surface and a third-party dependency.** Its
    macOS support is second-hand today. If the spike fails, this record is
    withdrawn, not bent.
  - **Every run costs minutes** of bundle build.
  - **It has no macOS precedent among peers.**
  - **A real double-click in Finder stays manual.**
- **Not decided here:** CI or Linux runs, and making the lane a gate.
