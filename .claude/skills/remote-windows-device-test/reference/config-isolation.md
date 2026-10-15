# Config isolation on Windows: snapshot before, restore after

WI-E2E-W item 5 (plan §4.7, "隔离" row). On macOS a run points `HOME` at a temp directory
(ADR-0047 `verify_run`). **On Windows that does not work, and there is no switch that does**, so
a run that changes settings, drafts or MCP state snapshots them first and restores them after.

## Why an environment variable does not isolate it

mdpro resolves its folders through the `dirs` crate. On Windows `dirs-sys` (0.4.1 and 0.5.0, both
in `Cargo.lock`) asks the Known Folder API (`SHGetKnownFolderPath`: `FOLDERID_Profile`,
`FOLDERID_RoamingAppData`). It does not read `USERPROFILE`, `APPDATA` or `HOME`, so changing
them before launch moves nothing. `verify_run.rs` is Unix-only. Real isolation would be app code:
a D or WI the user decides on, not a driver change. (From the source, 2026-10-15; confirm once on
the device by launching with `APPDATA` changed and checking that `%APPDATA%\mdpro` still updates.)

## What mdpro writes on Windows

| Path | What | Snapshot? |
|---|---|---|
| `%USERPROFILE%\.mdpro\config.json` | Preferences, shortcuts, window state | Yes |
| `%USERPROFILE%\.mdpro\mdpro.log` | The log: the run's evidence | Never restored; capture it with `log.sh raw` |
| `%USERPROFILE%\.mdpro\drafts\` | Legacy drafts, migrated on launch | Yes, if present |
| `%APPDATA%\mdpro\drafts\` | Drafts (recovery) | Yes |
| `%APPDATA%\mdpro\` (other files) | MCP server files: port and **token** | Yes, and they never leave the PC |
| `%APPDATA%\Claude\claude_desktop_config.json`, `%APPDATA%\Google\gemini\settings.json`, `%USERPROFILE%\.claude\settings.json`, `%USERPROFILE%\.codex\config.toml` | MCP client configs, written only by Settings › MCP › install | Only when the run installs into that client |
| `%LOCALAPPDATA%\com.mdpro.app\` | WebView2 profile. The frontend keeps no `localStorage`, so only cache [推断] | No |

## Steps

Run each on the PC (`ssh win-desktop "<command>"`). Each one changes state, so a lost connection
is an unknown outcome: check before you run it again (pitfalls 21). mdpro must be **closed**
for both snapshot and restore, which needs the user's OK (SKILL.md); otherwise config.json and
the drafts can change under the copy.

1. **Pick a run id** (`[A-Za-z0-9._-]+`), e.g. `e2e-20261015-1`. The snapshot goes to
   `C:\Users\jack\mdpro-audit\snap\<runId>\`.
2. **Snapshot** (mdpro closed):
   ```powershell
   $s = "$env:USERPROFILE\mdpro-audit\snap\<runId>"
   robocopy "$env:USERPROFILE\.mdpro" "$s\dot-mdpro" /E /COPY:DAT /R:0 /W:0 /XF mdpro.log /NJH /NP
   robocopy "$env:APPDATA\mdpro" "$s\appdata-mdpro" /E /COPY:DAT /R:0 /W:0 /NJH /NP
   ```
   robocopy exits below 8 on success. Add one `Copy-Item` per MCP client config the run will
   install into.
3. **Mark the log** (`log.sh mark`), start mdpro (`mdpro.sh debug --yes`), run the cases.
4. **Capture** with `log.sh raw <runId>.jsonl` before anything else.
5. **Restore** (mdpro closed):
   ```powershell
   $s = "$env:USERPROFILE\mdpro-audit\snap\<runId>"
   robocopy "$s\dot-mdpro" "$env:USERPROFILE\.mdpro" /MIR /COPY:DAT /R:0 /W:0 /XF mdpro.log /NJH /NP
   robocopy "$s\appdata-mdpro" "$env:APPDATA\mdpro" /MIR /COPY:DAT /R:0 /W:0 /NJH /NP
   ```
   `/MIR` also deletes what the run created (new drafts, a new token file). `/XF mdpro.log`
   keeps the log out of both the copy and the purge [推断: confirm at the first sitting that the
   log survives the restore].
6. **Check** that the restore matched: compare `Get-FileHash` of `config.json` and the drafts
   listing with the snapshot, and record both in the run manifest.
7. **Delete the snapshot** only after the run is recorded. It holds the MCP token, so it is
   never pulled to the Mac and never attached to a report.

## Limits

- Restore puts back mdpro's files. It does not undo what a run did elsewhere: files saved under
  a fixture folder, or another app's config the run did not snapshot.
- A run that crashes mdpro mid-write can leave `config.json.tmp`; `/MIR` removes it.
- These steps are written from the source and the skill's conventions. Running them once in a
  WI-E2E-W device sitting is what turns them into a checked procedure.
