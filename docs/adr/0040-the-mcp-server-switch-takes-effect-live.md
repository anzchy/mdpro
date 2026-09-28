# 0040. The MCP server switch takes effect live, through one serialized controller

**Status**: Accepted (2026-09-28); proposed 2026-09-27. Supersedes [ADR-0039](0039-mcp-server-enablement-is-read-once-at-launch.md).

## Context

ADR-0039 made `mcp.serverEnabled` gate the local MCP HTTP server once, at
launch, and rejected live start/stop. The GUI acceptance run of 2026-09-27
passed that design, and the Settings toggle now persists (ADR-0031 step 5b).
The user then decided (2026-09-27) that the toggle must take effect
**without a restart**. A design review by Codex was requested and informs
this record.

The code as it stands cannot support a second start:

- The launch state machine absorbs every event after its first terminal state
  (`src-tauri/src/services/mcp_launch_state.rs`).
- The server's shutdown sender is a `main.rs` static used only at exit.
- `http_server.rs` publishes `server.port` / `server.token` before the server
  task runs, and discards serve errors.
- The sidecar (`src-tauri/src/bin/mdpro_mcp.rs`) reads port and token once
  per process, so a restarted server with a new token would reject it for
  the rest of its life.
- The Settings dialog writes the whole `mcp` group through `set_preferences`,
  and the Rust merge replaces nested groups wholesale.

## Decision

1. **One command owns the switch: `mcp_set_server_enabled(enabled)`.** It
   persists first (the existing locked read–merge–save), then reconciles the
   server, and returns one status. Generic `set_preferences` writes preserve
   the on-disk `serverEnabled` rather than overwriting it. If persisting
   fails, the running server is untouched. If persisting succeeds and bind
   fails, the saved intent stays `true` and status reports `failed`; the
   preference is **not** rolled back. The command refuses with one of four
   wire strings (`switchError` in `tests/fixtures/mcp-status-contract.json`):
   `config_unreadable` and `persist_failed` (nothing changed), `exiting`
   (the app is quitting; nothing persisted or started), and
   `status_unavailable` — the value was persisted, but the server may not
   have been reconciled to it and the status could not be read back. The
   last one is a refusal on the wire only: the Settings toggle keeps the new
   value and re-reads the status.
2. **A managed `McpController` replaces the one-shot launch state.** An async
   mutex serializes launch, toggles, and exit. It owns the shutdown sender,
   the server task handle, and a generation counter. A separately readable
   snapshot carries `phase: disabled | starting | running | stopping |
   failed`, the port, and a bounded error enum. Launch goes through the same
   controller.
3. **Stop is complete only when the server task has joined.** Stop order:
   remove `server.port`, then `server.token`, clear the in-memory auth token
   so no new request authenticates, trigger axum's graceful shutdown, allow a
   bounded drain, abort if the drain expires, and await the task. Only then is
   the phase `disabled`. Immediate rebind is tested on macOS.
4. **Every start mints a fresh token.** The token file is written owner-only,
   then the port file last, after the listener is bound. The sidecar reloads
   port and token on a `401` or on connection failure and retries **only
   non-mutating** requests once.
5. **Status reports the runtime, not the launch.** `mcp_get_status` returns
   `phase` and the freshly read `configured`. The "takes effect after restart"
   note is removed. A saved-on-but-failed state is shown distinctly from an
   unsaved toggle.
6. **Kept from ADR-0039:** the server defaults on; launch reads `config.json`
   read-only; a missing, corrupt, or unreadable config at launch starts the
   server (fail-open), and the log records why.
7. **A corrupt config blocks the live toggle.** Fail-open is a launch rule,
   not a write fallback: the command refuses, the file's bytes are preserved,
   and status reports `unreadable`. Nothing is rewritten from defaults.
8. **Logging:** one action id per toggle with Start / Success / Fail; context
   carries direction, phase, error enum, and duration only — never the
   token, a path, or OS error text.

## Consequences

- The user can turn MCP off and on from Settings, and the badge shows what
  the server is actually doing.
- **Cost:** a controller with transitions, a drain deadline, and task joins
  replaces a one-shot flag. It is more code, and more places for a hang.
- **Cost:** turning MCP off interrupts in-flight requests. A request aborted
  at the drain deadline may leave its caller unsure whether a write landed;
  mutating requests are never replayed automatically.
- **Cost:** the sidecar protocol changes. Sidecars built before this change
  keep a stale token after a restart and must be relaunched by their client.
- **Cost:** a saved "on" that cannot bind stays on disk as `true`, so the
  settings and the runtime disagree until a retry or restart succeeds. That
  mismatch is shown, not hidden.
- **Cost:** with a corrupt config the user cannot turn MCP off from Settings
  at all, until the file is fixed.
- **Carried over from ADR-0039:** deleting `server.port` / `server.token` in
  the shared data dir can still hit a side-by-side build with a different
  bundle identity; stop now does it at runtime, not only at launch.
- `mcp.startOnLaunch` stays INERT and remains D25's to decide.

Related: ADR-0031 (preference persistence), ADR-0039 (superseded), D25 in
`docs/plans/20260912-frontend-backend-sequencing-order.md`.
