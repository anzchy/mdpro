<!-- Device-check record. Condensed by herdr-delegator from the report gpt-auditor wrote (device pane, Mac mini) at ~/.mdpro-redesign/device/CANARY036-report.md; brief ~/.mdpro-redesign/device/brief-CANARY036.md revision 2 (untracked). 3 PASS / 1 FAIL / 2 NOT EXERCISED (C1–C6). The FAIL is registered as D354. -->

# Post-publication canary: a released 0.3.5 client updates itself to v0.3.6 (2026-11-02)

**Why this run exists.** v0.3.6 was published as Latest on 2026-11-02 for macOS and Linux
([ADR-0164](../adr/0164-0-3-6-ships-macos-and-linux-only-and-windows-waits-for-its-device-batch.md)).
This is the same leg as [0.3.4 → 0.3.5](20261016-canary-034-to-035-device-check.md). A really released client
should:
- find 0.3.6 on `https://github.com/anzchy/mdpro/releases/latest/download/latest.json`;
- download and verify the payload, and replace its own bundle;
- relaunch once as 0.3.6;
- then report that it is up to date.

**Build.** Neither bundle is ours.
- **Client.** The released `mdpro_0.3.5_aarch64.dmg` (13727868 bytes, sha256 `136a2db8…5daf`), downloaded by the
  delegator and copied to the evidence folder. The user's `/Applications/mdpro.app` was not touched. Before the run:
  `CFBundleShortVersionString` 0.3.5, and `tauri-app` was 23346128 bytes with sha256 `4dced058…85de`.
- **Payload.** Whatever the updater fetched. The manifest read that day gave version `0.3.6`, with platforms
  `darwin-aarch64` and `darwin-x86_64`.
- **Run.** Tester gpt-auditor, 11:15–11:20 GMT+8, Mac mini. The desktop GUI lock was held, with acquisition
  `5deab4e9…`.

An earlier attempt the same morning stopped before any GUI step. The Codex command guard refuses `gh release`, so
the delegator staged the client, which became revision 2 of the brief.

## Verdicts

| Case | What | Verdict | Evidence |
|---|---|---|---|
| C1 | 0.3.5 finds 0.3.6 on the stable endpoint | **PASS** | `app.launch` `appVersion 0.3.5`; `app.ready` pid 16974, releaseId `0.3.5@67715ea2…`; `ui.about.update_check` success `hasUpdate:true, version:"0.3.6"`; UI `Update available — v0.3.6`, Install Update enabled |
| C2 | Check Again repeats it | **PASS** | second pair with `forceRefresh:true`, same result and UI |
| C3 | Install Update: download, signature, bundle swap | **PASS** | `Downloading update...` → `✓ Ready to install`; `ui.about.update_install` start/success, no error phase. Before restart, with pid 16974 still running: bundle `0.3.6`, `tauri-app` 24487856 bytes, sha256 `93c8e75a…49ec3` |
| C4 | Restart to Apply relaunches as 0.3.6, one process | **FAIL** ([D354](../plans/20260912-frontend-backend-sequencing-order.md#d354)) | one `ui.dialog.confirm` (`Restart to apply update?`) and one `ui.about.relaunch` start at 11:19:22.977; `app.quit` success; at 11:19:26.279 **two** `app.launch` `appVersion 0.3.6` lines in the same millisecond, then `app.ready` pids **40315** and **40317**, both from the canary path and both still alive 17 s later. Both report releaseId `0.3.6@d31ec182…`, buildId `unknown` |
| C5 | The upgraded client reports up to date | NOT EXERCISED | stopped at C4 |
| C6 | Smoke on 0.3.6 | NOT EXERCISED | stopped at C4 |

## What the two instances did
- **MCP server.** One instance logged `mcp.http_server.start` fail `bind_in_use`; the other bound port 55045.
- **Shortcut migration.** Both ran `preferences.shortcuts.migrate` 1 → 2 at once. One failed with `writeFailed`
  (`No such file or directory (os error 2)`) and the other migrated, which is a race on the same config write.
- **Windows.** Each opened a `main` window.

## Teardown
- Both instances were quit through mdpro › Quit mdpro (`app.quit` success twice). No `tauri-app` process was left.
- The relaunch rewrote `~/.mdpro/config.json` (the v2 shortcut migration). The tester kept that file as evidence,
  restored the pre-run copy, and `cmp` then passed.
- The canary app (now 0.3.6) and the DMG stay in the evidence folder.
- The lock was released and `status` shows FREE. The release call printed a refusal about the heavy keeper, but
  status showed both locks free.

## Reading
The relaunch runs in the **old** client: 0.3.5's `AboutSettings.tsx` makes a single `relaunch()` call from
`@tauri-apps/plugin-process`. The 0.3.4 → 0.3.5 canary relaunched as one process, so the double launch came in with
a change between 0.3.4 and 0.3.5. The cause is not yet determined. It may also need 0.3.6's own startup to refuse a
second instance, because a fix in the relaunch path only helps updates made from the fixed version.
