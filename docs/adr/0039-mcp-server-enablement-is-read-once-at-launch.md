# 0039. MCP server enablement is read once at launch, from a new key that defaults on

**Status**: Superseded by [ADR-0040](0040-the-mcp-server-switch-takes-effect-live.md) — 2026-09-28

## Context

mdpro spawns its local MCP HTTP server (127.0.0.1, token-authenticated)
unconditionally in `src-tauri/src/main.rs` setup. The Settings dialog has an
"enable MCP" toggle bound to `mcp.enabled`, but nothing reads that key: it is
one of the INERT preference leaves counted in D25. ADR-0031 step 5 restores
preference persistence in dependency order, and the user decided (2026-09-26)
that this preference should gate the server **at launch**, with a restart
required to change it. Live start/stop was rejected.

Honouring `mcp.enabled` as it stands would be a mass disable:

- `McpConfig::enabled` is `#[serde(default)] bool` (so `false`), and the TS
  `DEFAULT_MCP_CONFIG.enabled` is `false` too.
- `load_preferences()` writes the full default struct to `~/.mdpro/config.json`
  on first run, so every existing install has an explicit `"enabled": false`.
- ADR-0031 established that no frontend preference write has ever reached
  disk (the `isTauriEnv` detector is false until step 5b). Nobody chose that
  `false`; it is a materialised default.

A missing, corrupt, or unreadable config must not silently disable MCP, and
before step 5b the user has no in-app way to change the value. A server that
never starts leaves no in-app way to recover.

## Decision

1. **A new key gates the server: `mcp.serverEnabled`.** It has a serde default
   of `true` and a `Default` of `true` in Rust, and matches in TS. `mcp.enabled` is
   retired from both models. A legacy `enabled` left on disk is ignored
   (unknown fields are tolerated) and is dropped on Rust's next full write.
   The frozen `tests/fixtures/preferences-shipped-v1.json` witness is not
   edited; its round-trip test lists `mcp.enabled` as the single retired path.
   A retirement test proves that a legacy `enabled: false` blob still yields
   `serverEnabled == true`, which also rules out mapping the old key onto the
   new one with a serde alias.
2. **Read once, at launch, read-only.** Setup reads `config.json` without
   creating or rewriting it, decides, and either spawns the server or skips it.
   On a skip it logs `mcp.http_server.start {outcome:"skipped",
   reason:"disabled"}` and deletes the previous run's `server.port` and
   `server.token`, so no client finds a stale endpoint. That deletion is the
   only disk write the gate makes. Only an explicit `serverEnabled: false`
   skips.
3. **Fail open.** A missing file, a parse or I/O error, or a poisoned lock
   starts the server, and the log records the reason as an enum.
4. **Fresh installs stay on.** Today's behaviour is preserved. Making MCP
   opt-in would be a separate security/product decision with its own ADR.
5. **The UI states the truth.** `mcp_get_status` reports the launch state and
   the value currently on disk. Settings shows "takes effect after restart"
   when the two differ, and "not saved" when the toggle's write did not reach
   disk (always, until step 5b).

## Consequences

- A user who never touched the toggle keeps MCP. No install is disabled on
  upgrade.
- **Cost:** an on-disk key is renamed. That is a contract change. Anyone who
  hand-edited `enabled: false` to turn MCP off is switched back on silently.
  This is accepted because ADR-0031 shows the key never worked.
- **Cost:** fail-open means a corrupt config starts a server the user had
  disabled. The server is still loopback-only and token-gated. The log and
  the Settings "unreadable" note make the state visible, not silent.
- **Cost:** the change needs a restart. For a restart-bound setting,
  `mcp.startOnLaunch` becomes redundant. It stays INERT and is left for D25.
- **Cost:** until step 5b the toggle cannot persist anything. The value can
  only be changed by editing `serverEnabled` in `config.json`. The ledger row
  is `Partial` with that limit.
- The default posture stays "on". The old comment "opt-in only" was never
  enforced, and this record makes that explicit rather than fixing it.
- **Cost:** the skip deletes `server.port` / `server.token` in the shared
  `data_dir()/mdpro`. A build with a different bundle identity launched with
  MCP off beside a running mdpro would delete the running app's files. The
  single-instance plugin exits a same-identity second instance before setup,
  so only side-by-side builds are exposed.
- When disabled, the sidecar still reports "please start mdpro", and
  `mcp_install_config` still installs client configs. Both are misleading;
  both are left as they are.

Related: ADR-0031 (step 5), ADR-0032 (GUI acceptance lane), D25 in
`docs/plans/20260912-frontend-backend-sequencing-order.md`.
