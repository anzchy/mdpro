# Device tester

What the device tester (`gpt-auditor` in device mode for macOS since 2026-10-25; rule 70's real-device tester role)
does with a device brief. The brief names the batch, the build and each card; this file is the standing part (D355,
ADR-0147 WI-1). You write reports, never commits.

## Cards

Each `device` AC is a card under `docs/test/cards/` (ADR-0144). Launch the verify bundle by its full path, and check the
process path and the `app.ready` `releaseId` before any step. NOT EXERCISED is not PASS.

## Failure condition

<!-- moved-from: rule 70 § Device-check batches (ADR-0147) -->
- **Every item in a brief states its failure condition and the code path it
  must reach**, with the log line that proves the path was reached. A probe
  that passes without reaching its path is recorded as not exercised, not
  as passed (the D86 ⌘S×20 probe on `eb061fa`).

## Mac mini

<!-- moved-from: rule 70 § The Mac mini (ADR-0147) -->
- **Don't switch branches or rebuild in the mini's main checkout** for a device check; it belongs
  to the delegator. Builds for device checks use a separate
  `/Users/jack/Documents/mac-app/mdpro-wt/verify-<sha7>` worktree on the mini. Tell mdpro-device-harness whenever a mini
  worktree is created or removed. Never touch `src-tauri/target/verify`, and
  never `cargo clean` there.
- **Only real-device-tester runs GUI tests**, one run at a time. Never
  create, kill or restart its tmux session over SSH. Run
  `tmux capture-pane -pt <its tmux session>` (currently `dtrack`) once
  before sending it anything. Over SSH, put
  `/opt/homebrew/bin` on `PATH` first.
- **Dim text in the tester's input box is Claude Code's prompt suggestion,
  not anything the user typed.** Read the box with `capture-pane -ep`: a
  suggestion is wrapped in `ESC[2m`. Never submit it or report it as the
  user's answer. On 2026-10-17 a suggestion was taken for the user's S2
  answer and sent; the user had pressed no Esc (「I did not hit Esc」), and
  the run was recorded as not exercised.
- **A long `send-keys` string needs `C-m`, not `Enter`, to submit**, and
  nothing goes through while a read-only viewer (`tmux attach -r`) is the
  session's most recent client: `send-keys` answers "client is read-only"
  and delivers nothing. Check `tmux list-clients` first; a viewer is
  detached with `tmux detach-client -t <tty>` only with the user's word
  (2026-10-11, the claude-mem viewer on ttys006). `capture-pane` is
  unaffected either way.
- Copy files with `rsync`, not `scp`. Never pass
  `StrictHostKeyChecking=no`. Never copy `~/.mdpro` or `~/.claude`, and never
  print the MCP token or the hook receiver token.

## Win-desktop lock

Every command on `win-desktop` runs under the win-desktop lock, held for the whole brief, from the first SSH to the
readback, and only by the agent the brief names. It is not the Mac's `desktop-gui.lock`. The full rule is
[device-batches.md](../../.agents/skills/mdpro-delegator/references/device-batches.md#win-desktop-lock).
