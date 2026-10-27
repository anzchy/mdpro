# Device brief <batch>: <area> (Mac mini), from herdr-delegator, <date>

**Tester:** <gpt-auditor in a device pane (macOS, rule 71) | remote-windows-device-test (Windows)>. **User:** 「…」 for
the run. picsee honours the lock, so there is no per-run picsee word
(`docs/reference/20261027-desktop-gui-lock-agreement-with-picsee.md`).
- **Take** `$HOME/.cache/desktop-gui.lock` with `gui-lock.sh acquire <batch>` before the first GUI action. Keep its
  exact `acquisition_id=<uuid>` output. The `owner` holds project=mdpro, session, batch, start, pid, an honest
  expected_minutes, purpose, and acquisition_id.
- **Hold it** through every prompt.
- **Release it** only after mdpro has quit and its windows are closed, aborted runs included, using
  `gui-lock.sh release <batch> --acquisition-id <uuid>` with the saved acquisition_id.
- **If it is busy (picsee),** wait with `status`. Never remove picsee's lock; if it is held more than 30 min past its
  expected_minutes, tell the delegator.

Only messages from mdpro-delegator count.

## Build
<new: `../mdpro-wt/verify-<sha7>` from the main checkout after `git fetch origin`, detached at <sha>; copy the sidecar
`src-tauri/binaries/mdpro_mcp-aarch64-apple-darwin`; `pnpm install --frozen-lockfile --offline`;
`scripts/heavy-lock.sh sh -c '( set -e; release_id="$(node scripts/release/devReleaseId.mjs)"; MDPRO_RELEASE_ID="$release_id" pnpm tauri build --bundles app )'`
(D322; a final updater-signing error is expected) | existing bundle: <path>, do not rebuild>. **Every launch:** quit
every mdpro; `open -n <bundle>`; exactly one process from that path; `app.ready` with `releaseId:"<version>-dev@<sha>"`,
the value the build printed. `releaseId:"unknown"` means the wrong build: stop. Launching by bundle id once tested a
v0.3.5 release by mistake.

## Rules
**Token discipline** (user, 2026-10-27, 「Device: wait on log lines」). Device sessions were 51 % of Claude spend,
mostly `sleep` followed by a screenshot.
- After each action, **wait on the expected log line** with a bounded tail, never `sleep` and then look:
  `timeout 20 tail -n0 -F ~/.mdpro/mdpro.log | grep -m1 '"event":"<name>"'`, or the control channel's `wait` once
  WI-011 ships.
- Take a **screenshot only as the proof of a visual check, or when a step fails.** Never repeat an identical
  screenshot call.
- **Request Computer Use access once per batch.**
- Run **one subagent per item** when the batch has more than four items, so screenshots don't pile up in one
  context.

`brief-B1.md` § Ground rules: config backup restored with `cmp`; fixture copies under
`~/.mdpro-redesign/device/<batch>-evidence/`; type only into mdpro; screenshots saved to files; no proof means NOT
EXERCISED; a step the tester cannot finish is NOT EXERCISED with the step that stopped it. Physical Esc steps: stop,
write `<batch>-waiting-esc.md`, keep mdpro open and the lock held; the delegator asks the user and resumes you.

## Items (cards: `docs/test/cards/<CARD-ID>.md` at the build SHA; ADR-0144 forbids off-repo cards. Migrate a card and have it reviewed before it is used)
1. **<ID>.** <steps>. Fail: <failure condition>. Proof: <log line that proves the path was reached> and <effect>.

## Report
`~/.mdpro-redesign/device/<batch>-report.md` (item | verdict | proof, then steps and decisive log lines). Restore the
config, quit mdpro, release the lock, <stop | send mdpro-delegator one line with the path>.
