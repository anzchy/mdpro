# 0054. A locked MCP switch mirrors the running server

**Status**: Accepted (2026-10-07, decided by the user for D25 / ADR-0042 issue 1).

## Context

The ADR-0040 device run B2 (2026-09-28) opened Settings with a corrupt
`config.json`. The server started (fail-open, ADR-0039), and the Integrations
panel then contradicted itself:

- The locked "Enable MCP Server" switch showed **Off**, next to a **Running**
  badge. `SettingsDialog` leaves `mcpConfig` at `null` when the preference load
  fails (D24 F3), and the switch fell back to `false`.
- Two notes said nearly the same thing at once. The lock reason said "MCP
  settings couldn't be loaded — close and reopen Settings to retry". The status
  region said "Settings file unreadable — fix it to change this setting".
  Rule 30.5 allows at most one inline note. Reopening Settings does not help
  when the file itself is corrupt.

While the config is unreadable, the saved value is unknown. The only fact the
panel has is the live `phase` from `mcp_get_status`. ADR-0040 decision 7
already keeps the switch locked in this state.

Options considered: mirror the live phase; show an indeterminate
(`aria-checked="mixed"`) switch; hide the switch.

## Decision

1. While the `mcp` group is not loaded (`mcpConfig === null`: loading or
   failed), the locked server switch shows **on** when `phase` is `running` or
   `starting`, and **off** otherwise. This includes when no status is
   available. Once the group has loaded, the switch shows the saved
   `serverEnabled` as before.
2. When the load failed **and** the status reports `configured: "unreadable"`,
   only the status note ("Settings file unreadable — fix it to change this
   setting") is shown, and it is what the locked toggles are described by. In
   every other lock case the existing lock reason stays.
3. "Start on launch" and "Auto-approve edits" have no live counterpart. They
   stay locked and unchecked while unloaded.

## Consequences

- The switch and the badge can no longer contradict each other while the file
  is unreadable. The one remaining note tells the user what fixes it.
- **Cost:** while unloaded, the switch means "what is running", not "what is
  saved". A server that fails open on a corrupt file shows **on**, even if the
  file's last good value was off. The panel cannot know that value.
- **Cost:** a load failure that is not an unreadable file (for example an IPC
  rejection) still shows the old lock reason. Only the unreadable case
  collapses to one note.
- **Forecloses:** an indeterminate visual state for `McpToggleRow`. Adding it
  later needs a new ADR that supersedes this one.

Related: ADR-0039 (fail-open launch), ADR-0040 decision 7 (a corrupt config
blocks the switch), ADR-0042 (whose follow-ups the D25 row numbers as issues 1–3), D25 in
`docs/plans/20260912-frontend-backend-sequencing-order.md`.
