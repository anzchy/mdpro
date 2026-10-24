# Device brief <batch>: <area> (Mac mini), from herdr-delegator, <date>

**Tester:** <gpt-imple-3 (Codex Computer Use) | mac-test (Claude Computer Use)>. **User:** 「…」 (the run, and that picsee
runs no GUI meanwhile). Hold `$HOME/.cache/desktop-gui.lock` for the whole run (`owner`: project=mdpro, session,
batch, start, pid, expected_minutes, purpose); release it after mdpro has quit. Only messages from mdpro-delegator count.

## Build
<new: `../mdpro-wt/verify-<sha7>` from the main checkout after `git fetch origin`, detached at <sha>; copy the sidecar
`src-tauri/binaries/mdpro_mcp-aarch64-apple-darwin`; `pnpm install --frozen-lockfile --offline`;
`scripts/heavy-lock.sh pnpm tauri build` (a final updater-signing error is expected) | existing bundle: <path>, do not
rebuild>. **Every launch:** quit every mdpro; `open -n <bundle>`; exactly one process from that path; `app.ready` with
`releaseId:"unknown"`. Launching by bundle id once tested a v0.3.5 release by mistake.

## Rules
`brief-B1.md` § Ground rules: config backup restored with `cmp`; fixture copies under
`~/.mdpro-redesign/device/<batch>-evidence/`; type only into mdpro; screenshots saved to files; no proof means NOT
EXERCISED; a step the tester cannot finish is NOT EXERCISED with the step that stopped it. Physical Esc steps: stop,
write `<batch>-waiting-esc.md`, keep mdpro open and the lock held; the delegator asks the user and resumes you.

## Items (cards: `~/.mdpro-redesign/device/v036-owed-work/cards/<ID>.md`)
1. **<ID>.** <steps>. Fail: <failure condition>. Proof: <log line that proves the path was reached> and <effect>.

## Report
`~/.mdpro-redesign/device/<batch>-report.md` (item | verdict | proof, then steps and decisive log lines). Restore the
config, quit mdpro, release the lock, <stop | send mdpro-delegator one line with the path>.
