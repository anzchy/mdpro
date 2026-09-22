# D2 — Logging toggle, real-device QA (2026-09-22)

Closes residual ① of D2: "turning logging off in Settings stops writes to
`~/.mdpro/mdpro.log`, survives a relaunch, and turning it back on resumes them."

Evidence is **byte and line deltas** on `~/.mdpro/mdpro.log`, not timings or
screenshots. `logstat.js <fromByte>` printed the file size and line count, plus
every line appended after `<fromByte>`.

## Binary under test

| Field | Value |
|---|---|
| Build | `pnpm tauri build` (release) in a clean detached worktree at `44607d8` |
| Bundle | `src-tauri/target/release/bundle/macos/mdpro.app`, id `com.mdpro.app`, v0.3.0 |
| `Contents/MacOS/tauri-app` sha256 | `0440b48f9b2b5730ce20298ed8323dde79c26350ed731d615fc4e5d76108fb03` |
| Note | The updater-signing step failed with "no TAURI_SIGNING_PRIVATE_KEY". That is unrelated, and the `.app` was produced. The MCP sidecar was built with `cargo build --release --bin mdpro_mcp` and copied into `binaries/`, as in `release.yml`. |

Fixtures: `d2-a.md` and `d2-b.md`, two-line scratch files outside the repo.

## Steps and evidence

| # | Action | Log after | Delta |
|---|---|---|---|
| 0 | Baseline, app not running | 2 976 113 B / 11 041 lines | — |
| 1 | Cold launch (opening `d2-a.md`) | `app.launch` logged, then `appReady:false`, then window `main` | +28 lines |
| 2 | Settings → Advanced → **uncheck** Enable Logging | Exactly one final line: `ui.toggle.change {"controlId":"settings.advanced.logging.enabled","newValue":false}` (11:38:59.983). `config.json` reads `logging.enabled: false`. | mark = **2 984 407 B / 11 072 lines** |
| 3 | Open `d2-b.md` (`open -a`); ⌘N; click the `d2-b` tab; ⌃2; type " edited"; ⌘S (the file on disk changed, mtime 11:39:34); ⌃4 | 2 984 407 B | **0 B** |
| 4 | Quit (AppleScript `quit`) | 2 984 407 B | **0 B** |
| 5 | Relaunch (opening `d2-a.md`); open `d2-b.md`. `config.json` still reads `enabled: false` | 2 984 407 B | **0 B** (no `app.launch`) |
| 6 | ⌘N; switch tab; ⌃2; type " again"; ⌘S (the file on disk reads "beta line edited again", mtime 11:40:23); ⌃4; ⌘, → Advanced shows the box **unchecked** | 2 984 407 B | **0 B** |
| 7 | **Check** Enable Logging; close Settings; ⌃2; ⌃4 | 2 992 046 B / 11 103 lines | **+31 lines** (`settings.close`, `view.mode.change` ×2, `editor.milkdown.mount`, …). `config.json` reads `enabled: true`. |

Logging was left **ON** (`{"enabled": true, "level": "info"}`).

## Verdict

**DONE.** Off stops every write: 0 bytes across new tab, tab switch, both mode
switches, save, quit, and relaunch. The off state persists across a relaunch,
both in `config.json` and in the Settings UI. On resumes writes immediately.

## Observations (not D2 failures)

- **The ON transition is not itself logged.** `handleLoggingToggle`
  (`AdvancedSettings.tsx:29`) logs `ui.toggle.change` *before*
  `setLoggingSettings` takes effect. So the off event is written (logging is
  still on at that point), but the on event is dropped (logging is still off).
  The first line after re-enabling is `settings.close`. The log therefore shows
  a gap with no record of who reopened it.
- **`ui.menu.select menu.view.set_mode` is written 10× per ⌃2 / ⌃4.** Each
  mode switch produced one `view.mode.change` but ten `ui.menu.select` lines
  within about 30 ms. That suggests ten live `menu:action` listeners
  (`useMenuEvents.ts:86`) in the webview(s) after this session's opens and
  relaunch. This was not investigated further. It is worth a follow-up: is it
  one listener per window, or a listener leak?
