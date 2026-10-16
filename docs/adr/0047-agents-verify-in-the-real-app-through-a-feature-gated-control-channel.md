# 0047. Agents verify work in the real app through a feature-gated control channel, chosen by a spike

## Status

**Proposed** (2026-10-02). Becomes Accepted when the spike in Decision 4 has
run, its record is in `docs/test/`, and the selection rule in Decision 5 has
named a driver or the fallback. The chosen driver then gets its own dependency
ADR.

**Partially superseded** (2026-10-15): decision 4's S2 control build ("the `src/` part of
`c39dfb1` … reverted") by [ADR-0100](0100-the-s2-negative-control-is-a-minimal-confirmdialog-patch.md).

**Partially superseded** (2026-10-16): decision 4's "without first focusing the dialog" by
[ADR-0113](0113-the-s2-control-takes-focus-out-of-the-dialog-with-one-backdrop-click.md) (one
backdrop click before the Esc, on every S2 run).

**Reviewed before drafting** (Codex, thread `01a0fa10…`, verdict *needs
revision*). The review replaced "build an in-repo plugin now" with a spike,
and added the Tauri version dependency, data isolation, and the evidence
classes below.

**Amended in place while Proposed** (2026-10-02). A second review (Codex,
thread `01a0fa60…`, verdict *needs revision*) read the execution plan against
this record. It found that the plan had changed decisions this record still
stated the old way, and that two safety conditions were missing. The
amendments:

- decision 3: a third collision (the single-instance socket), a verification
  identity, one active run, a build identity that covers content, and a
  launcher that proves ownership before it ends or deletes anything;
- decision 4: the candidates run in order; S1 also screens execution routes,
  replay and `eval`; S2's negative control is one that can be built; S5
  compares meaning, not log text;
- decision 5: the rule covers a failure at any screen, names a maintenance
  budget, and makes the built implementation pass the screens again;
- decisions 6 to 8: "no control-channel listener", what a capability file is
  for, two more probes, and replay;
- the costs that follow from these.

**Relation to ADR-0034.** ADR-0034 (Proposed) decides a pre-release journey
lane. This record decides the channel that lane, and everyday verification,
drive the app through. It does not supersede ADR-0034. It replaces four parts
of it, and ADR-0034 was amended on 2026-10-02 to point here for them:

- its spike order (decision 2), which tried `tauri-plugin-mcp-bridge` first;
- its "one Cargo feature" difference from the shipped build (decision 3);
- its security conditions (decision 4), restated here per transport;
- its log path (decision 6), which in an isolated run is the run directory's.

ADR-0034's lane and its first journeys are not delivered by this record.

Numbered 0047 because 0046 was already taken on the `d41-source-tab-gaps`
branch, merged since.

## Context

**An agent cannot confirm that a change works in the running app.** The two
automated lanes (`unit`, `rust`) never launch it. Runtime checks go through
`gui-acceptance` and `gui-manual-verify`, so every work item waits for a
person. ADR-0034 addresses regressions before a release. It does not address
this per-work-item wait.

**WKWebView has no Chrome DevTools Protocol.** Survey of 2026-10-02:

- First-hand:
  - Tauri's `tauri-driver` has no macOS support. Tauri's docs recommend
    WebdriverIO with a WebDriver server embedded in the app.
  - `tauri-plugin-wdio-webdriver` 1.4.0 is MIT, requires Tauri 2.10.0 or
    later, and builds its key input from `KeyboardEvent`.
  - `tauri-plugin-mcp-bridge` 0.13.0 has an open cross-site WebSocket
    hijacking issue (#36). Its fix (#38) is unmerged.
  - `P3GLEG/tauri-plugin-mcp` has no LICENSE file.
- Second-hand (research agent's and reviewer's reading of upstream source):
  - the WebdriverIO plugin listens on `127.0.0.1:4445` with no credential,
    and its clicks are synthetic too;
  - it replaces the webview's UI delegate, adds a 50 ms run-loop timer, has
    more than one route that executes a script, and can re-run a script when
    eval recovery fires (read on upstream `main`, not in the 1.4.0 crate);
  - `tauri-plugin-mcp-bridge` binds `0.0.0.0` by default with no credential,
    and #38 adds an Origin check, not a credential;
  - `P3GLEG/tauri-plugin-mcp` sends keys as `NSEvent` through `NSApp`;
  - no way was found to attach to a desktop WKWebView's Web Inspector from a
    program;
  - no in-app driver reaches the menu bar or the open and save panels.

**Facts in this repo:**

- `Cargo.lock` pins Tauri 2.9.5. `Webview::eval_with_callback` is absent
  there and present in 2.11.5.
- Preferences and the log live in `~/.mdpro`; drafts live under
  `~/Library/Application Support/mdpro`. A test run uses the real ones.
  Every Rust path resolves through the `dirs` crate, so it follows `$HOME`.
  The webview's own store does not: wry uses WebKit's default data store,
  and a store of its own needs macOS 14.
- The MCP server binds the fixed port 55045, which an installed mdpro also
  claims.
- `tauri-plugin-single-instance` listens on `/tmp/com_mdpro_app_si.sock`.
  The name comes from the bundle identifier, not from `$HOME`. A second
  mdpro started while one runs hands over its arguments and exits.
- `main` writes a log line and migrates drafts before the Tauri builder
  runs.
- Frontend console errors and unhandled rejections are captured nowhere.
- No store or editor view is reachable from outside the webview. The shadow
  store holds the active document and dirty flag, but it is debounced.
- The `menu:action` focus check fails open (`src/hooks/useMenuEvents.ts`).
- `progress.md` (2026-09-30): dialog keyboard behaviour is settled only by a
  physical keypress. Injected keys are recorded NOT VERIFIED.

**Constraint.** E39 forbids timing thresholds as blocking gates.

## Decision

1. **Add a control channel for agents, with one CLI on top.** It serves
   verification of each work item during development, and it is the channel
   ADR-0034's lane uses. Nothing here makes it a gate.
2. **The channel has two layers.**
   - An in-app driver reaches the webview.
   - The menu bar, open and save panels, the quit alert and Finder stay with
     `gui-acceptance`. ADR-0034 rejected native automation as *the lane*;
     here it only covers what the driver cannot reach.
3. **Four preconditions land before any driver, each as its own change.**
   - **Tauri is upgraded** to a pinned, tested set of versions at 2.10 or
     later. Both candidates need it.
   - **A verification run is isolated.**
     - It never reads or writes the real `~/.mdpro` or
       `~/Library/Application Support/mdpro`.
     - It does not collide on port 55045.
     - It is never routed into another running mdpro, whether the installed
       one or another verification run.
     - The verification build therefore has its own bundle identity and
       packaging profile, and it refuses to start outside an isolated run.
       One verification run is active at a time.
     - Isolation is partial, and each record says so: WebKit's own data
       sits outside the run directory, and on macOS 13 it persists between
       runs.
   - **Every run proves it is a fresh process** (ADR-0034 decision 5) **of
     the expected build.** The build identity covers the content that was
     built, not only the commit. A run that can prove neither ends NOT
     VERIFIED.
   - **The launcher proves ownership.** It ends only a process it can prove
     it started, and deletes only a directory it can prove it created. A
     recorded pid alone proves neither.
4. **The driver is chosen by a spike of up to two candidates, in order.**
   `tauri-plugin-wdio-webdriver` goes first. An in-repo plugin is spiked only
   if the first does not qualify under Decision 5.
   `tauri-plugin-mcp-bridge` is not a candidate while #36 is open. The time
   box is two working days per candidate, to be confirmed at acceptance. The
   screens run in this order, and a candidate that fails one stops there:
   - **S1, compatibility, security and execution safety.**
     - It builds as a release-profile bundle behind one off-by-default Cargo
       feature, and every listener it opens meets Decision 6.
     - Every route that can run a script or send input is listed from the
       pinned crate's source, and each one requires the credential.
     - With `eval` not enabled, the server refuses arbitrary script on every
       one of those routes.
     - A mutating request runs at most once. This is tested with injected
       faults: a lost response, a delayed completion, a disconnect and a
       duplicate request.
     - A request has a defined result: a correlation id, an error envelope,
       a timeout, and a late result that is discarded.
   - **S2, input against a physical baseline.** One build is the spike
     branch with the `src/` part of `c39dfb1` (the D34 fix) reverted. The
     other is the spike branch as it is. `8a73eeb` itself cannot host a
     driver, because it is on Tauri 2.9.5. A person takes the baseline on
     both by hand. If the physical Esc closes `ConfirmDialog` on the
     reverted build, the control is void and S2 is redesigned before the
     spike goes on. The driver's Esc must then give the same result on
     both, failure included, without first focusing the dialog. The record
     holds the native key window, DOM focus, the receiving window and the
     log line.
   - **S3, the editors.** In CodeMirror and in Milkdown: typing, selection,
     undo, a modifier shortcut, and a click that triggers asynchronous IPC.
   - **S4, ADR-0034's three criteria.** It drives a packaged `.app` on macOS
     13+ on Apple Silicon; it addresses windows by label; its registration
     does not reorder or bypass `tauri-plugin-single-instance` or
     `RunEvent::Opened`.
   - **S5, instrumentation effect.** The same journeys run by hand on the
     verification build with the driver feature off. The comparison is of
     meaning, not log text: an allowlist of app events, their causal order,
     normalised identities, the payload fields that matter, and the final
     state on disk. A person also samples the journeys on the production
     packaging, to cover the difference the packaging itself makes.
   - **S6, cost.** Lines owned here, and upstream patches carried.
5. **Selection rule, fixed before the spike starts.**
   - The WebdriverIO plugin is chosen if it passes S1 to S5 and what this
     repo must carry stays inside a maintenance budget: a patch of about
     300 lines at most, limited to the listener, authentication and the
     route table. The number is confirmed at acceptance. Sending the patch
     upstream does not end ownership of it.
   - The in-repo plugin is chosen if the WebdriverIO plugin does not
     qualify, at whichever screen, and the in-repo plugin passes S1 to S5.
   - If neither passes inside the time box, the channel is fixed read-only
     state probes only, and all input stays manual.
   - Selection is not verification. The implementation that is then built
     passes S1 to S5 again, both S2 builds included. The spike's patches,
     revisions and build manifests are kept until it has.
6. **The channel is an attack surface.** These replace ADR-0034 decision 4:
   - a dedicated credential, minted per launch, never `server.token`, kept in
     a private per-run directory, dead when the process exits;
   - an HTTP listener is loopback only, checks Host and Origin strictly,
     requires the credential on every route, and has no wildcard CORS;
   - a Unix socket is mode 0600 inside that private directory and requires
     the credential on every request. Host and Origin do not apply to it,
     and that is stated, not claimed as met;
   - a proxy in front of an unprotected listener does not count;
   - the feature build opens the channel only when launched with an explicit
     opt-in. Without it, it opens no control-channel listener. The MCP
     server is a separate listener and still starts;
   - a capability file is added only if the driver needs Tauri IPC
     permissions. It then exists only in the feature build. It is not what
     protects a listener that Rust owns; the credential is;
   - ADR-0034's three-layer clean-release check applies, plus an attempted
     runtime activation against the release bundle, because an in-repo
     plugin has no driver crate to look for.
7. **Acceptance uses fixed probes; `eval` is a diagnostic.**
   - Probes are versioned and read-only: window labels, whether each
     window's frontend is ready, active document, dirty flag, view mode,
     pending confirmation prompts, and a console and error buffer with
     sequence numbers and an overflow count, installed before the app's
     modules run.
   - A probe never flushes, focuses or synchronises state.
   - Arbitrary `eval` is enabled separately at launch. Otherwise the server
     refuses it, on every route that can run a script. Its output is never
     acceptance evidence.
8. **Every result names its evidence class.**
   - Driver input is recorded as driver input. It never discharges the
     physical-key rule in `progress.md`, and IME stays manual.
   - A verdict is one of: pass, fail, driver failure, unknown outcome,
     NOT VERIFIED.
   - A mutating command that timed out is an unknown outcome. The CLI does
     not retry it, the driver does not replay it, and a result that arrives
     late does not change the verdict.

## Alternatives rejected

- **Build the in-repo plugin now, without a spike.** Its key-input advantage
  is unproven, its API is missing at the pinned Tauri, and its estimate left
  out transport, result delivery and lifecycle.
- **Adopt the WebdriverIO plugin as it is.** Its listener has no credential.
- **Adopt `tauri-plugin-mcp-bridge`**, as ADR-0034 ordered. It fails Decision
  6 today.
- **Depend on `P3GLEG/tauri-plugin-mcp`.** It has no licence and one
  maintainer.
- **CrabNebula's macOS WebDriver.** It is paid and closed.
- **Playwright against the Vite dev server.** It runs a different WebKit
  build with IPC mocked, and proves nothing about menus, windows or Rust.
- **Add control routes to the MCP HTTP server.** That server ships in the
  release build; the routes would turn a document API into code execution.

## Consequences

- **Gives:** an agent can check routing, state, persistence and console
  errors in the real app for each work item, and hand back evidence. The
  person is asked for what only a person can judge.
- **Costs:**
  - **A Tauri upgrade comes first**, before any benefit, with its own
    regression risk.
  - **The surface is open all day** on a developer machine, not for minutes
    before a release.
  - **It is still not the shipped binary.** The build under test differs by
    a packaging profile (identity, name, no file associations, no updater
    artifacts), by the isolation behaviour, and by the driver. S5 only
    samples those differences.
  - **There are three builds to keep apart:** shipped, verification with
    the driver off, and verification with it on. One build entry point has
    to make sure a run is talking to the one it thinks it is.
  - **Isolation is partial.** WebKit's data is outside the run directory,
    and on macOS 13 it persists between verification runs.
  - **One run at a time.** Two agents, or two worktrees, cannot verify at
    once.
  - **The verification build is not a usable app.** It refuses to start
    when opened by hand outside a run.
  - **Something is maintained either way:** a patch against upstream, or
    Objective-C interop owned here.
  - **The spike can end with two half-built tools.** Running the candidates
    in order, and the stop conditions, are the only guard.
  - **The screens are run twice:** once to choose, once on what is built.
  - **The person stays in the loop** for physical keys, IME, native panels
    and paint.
  - **A probe can hide a defect** if it ever changes the state it reads.
  - **Every build costs minutes**, and the new commands need feature-ledger
    rows.
- **Not decided here:** the CLI's command set and where it lives, how a
  feature map relates to `docs/feature-ledger.md`, how a probe reads
  frontend state (a script injected over the DOM, or a frontend build
  variant), and any CI use.
