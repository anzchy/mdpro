---
name: remote-ssh
description: Connect to a remote device over Tailscale SSH — default host is `mac-mini` (Jack's Mac mini). Use when the user asks to ssh / connect / run a command on the mac mini or another tailnet device, move work or files to it, or when an SSH to a 100.x address fails (403 banner, permission denied, host key verification failed).
---

# Remote SSH over Tailscale

Default target: **`mac-mini`** — an alias in `~/.ssh/config`:

```
Host mac-mini
    HostName jacks-mac-mini      # MagicDNS → 100.124.189.67
    User jack                    # NOT the local user `jackcheng`
    IdentityFile ~/.ssh/id_ed25519
    StrictHostKeyChecking accept-new
```

Use a different host only when the user names one (`$ARGUMENTS` = host alias or
tailnet name; empty → `mac-mini`).

**Paths and users are different on each machine. Never assume they mirror each
other:**

| | Local (MacBook) | Remote (`mac-mini`) |
|---|---|---|
| User | `jackcheng` | `jack` |
| mdpro repo | `~/Documents/01_Coding/mac-app/mdpro` | `/Users/jack/Documents/mac-app/mdpro` |
| Display | Retina @2x | 1920×1080 @1x |

For any other path, ask the user before using it.

## 1. Preflight (one call)

```bash
tailscale status 2>&1 | head -20; route -n get <host-ip> | grep interface
```

- `Tailscale is stopped.` → run `tailscale up`, then re-check. This is the
  usual cause of failures.
- The peer row says `offline` → stop and tell the user the device is offline.
  Retrying won't help.
- The route interface must be the **Tailscale utun**, not Clash's. Clash TUN
  shows gateway `198.18.0.1`.

## 2. Connect

Non-interactive check (always use `BatchMode` from the agent — a password
prompt would hang):

```bash
ssh -o BatchMode=yes -o ConnectTimeout=10 mac-mini 'hostname; whoami'
```

Run a remote command: `ssh -o BatchMode=yes mac-mini '<cmd>'`.
For an interactive shell, tell the user to type `! ssh mac-mini`.

Report `ok` plus the hostname/user on success.

### Remote shell quirks (non-interactive zsh)

- **Single-quote the whole remote command.** Otherwise the local shell expands
  it first.
- **Don't start a word with `=`.** In zsh, `echo ===local` triggers `=`
  expansion and errors. Quote the word or reword it.
- **Homebrew is not on PATH over SSH.** Prefix the command:
  `ssh mac-mini 'export PATH=/opt/homebrew/bin:$PATH; pnpm -v'`.
- **Rust:** `brew install rustup` is keg-only. Its binaries are in
  `/opt/homebrew/opt/rustup/bin`, and there is no `rustup-init`. The first
  `rustc` call installs the stable toolchain. That path is not in the mini's
  `~/.zshrc`, so a Terminal-launched session won't find `cargo` either.

### Long remote jobs

Run `ssh mac-mini '… > ~/job.log 2>&1'` with Bash `run_in_background` and wait
for the completion notification. An SSH session can't report that a job
finished on its own, so don't poll in a loop.

`pnpm tauri build` on a machine without `TAURI_SIGNING_PRIVATE_KEY` exits 1
while building the updater tarball, after `mdpro.app` is already built. Judge
success by the bundle's mtime, not the exit code.

## 3. Permissions (Claude Code rules)

Permission rules match the **literal command text**. They don't resolve SSH
aliases.

- If the allow rule is `Bash(ssh jack@jacks-mac-mini.tailec6deb.ts.net:*)`, it
  never matches `ssh mac-mini …`, so alias commands fall through to the
  classifier. The rule needs to match the form this skill uses, e.g.
  `Bash(ssh mac-mini *)`. Ask the user to add it. **Don't edit settings
  yourself.**
- **Deny beats allow at every level.** The global deny `Bash(scp *)` overrides
  any `scp … mac-mini:` allow, project-level ones included.
- **A compound command is checked segment by segment.** If one segment is
  denied, the whole line is denied. So `ssh … && scp …` loses the ssh part too.

## 4. File transfer

Use `rsync`, never `scp` (it's denied). Run **one transfer per command**, and
don't chain it with other commands:

```bash
rsync -a <local-src> mac-mini:<remote-abs-dst>     # file or folder
```

Never copy `~/.mdpro` or `~/.claude` to the remote wholesale. They hold
preferences, drafts and credentials.

## 5. Moving a git repo (no GitHub on the remote)

The mini has no GitHub auth, and redesign branches must not go to `origin`.
Push straight over SSH:

```bash
ssh mac-mini 'git init -b handoff-init <remote-abs-path>'  # placeholder branch avoids denyCurrentBranch
git remote add mac-mini ssh://mac-mini/<remote-abs-path>
git push mac-mini <branch>...
ssh mac-mini 'cd <remote-abs-path> && git switch <branch> && git rev-parse HEAD'  # compare with local SHA
```

The full runbook (gitignored sidecar binary, evidence folders) is
`docs/plans/20261004-remote-device-migration-via-tailscale.md` on
`docs/stage-0-redesign` (e121110).

## 6. GUI work on the remote

Processes started over SSH have no Screen Recording or Accessibility grant.
`screencapture`, System Events keystrokes and computer use all fail from an SSH
session. GUI checks must run from a Claude started in **Terminal.app on the
mini's console session**. Only the user can do the one-time setup:

1. Grant Terminal **Screen Recording** and **Accessibility** (System Settings →
   Privacy & Security).
2. Turn on **Keyboard navigation** (System Settings → Keyboard).
3. Switch the input source to **ABC**.

Check the display with
`system_profiler SPDisplaysDataType | grep -E "Resolution|UI Looks like"`.
Screenshot coordinates differ from the @2x MacBook.

### Driving device checks: the `dtrack` tmux session (user preference)

**Every GUI device check goes to the one long-lived tmux session `dtrack`.** Don't
open a new Terminal window per run (`osascript … do script`), and don't start
another Claude next to it. Each extra Claude can hold the computer-use lock and
block the next run.

- **The user owns the session.** They created it in Terminal.app on the console with
  `tmux new -s dtrack -c ~/.mdpro-redesign/dtrack`, then ran `claude` inside it.
  That way it inherits Terminal's Screen Recording / Accessibility grants.
  - A tmux server started over SSH has no grants. So **never create, kill or
    restart `dtrack` or its Claude from SSH.**
  - If `tmux ls` doesn't list `dtrack`, ask the user to recreate it.
- **Files:**
  - briefs: `~/.mdpro-redesign/dtrack/brief-<date>-<id>.md`, rsynced over;
  - reports: `~/.mdpro-redesign/dtrack/reports/<date>-<id>.md`;
  - screenshots: `reports/shots/<prefix>-*.png`.
- **Before sending, check that the session is idle.**
  - Run `ssh mac-mini 'export PATH=/opt/homebrew/bin:$PATH; tmux capture-pane -p -t dtrack | tail -25'`.
  - Send only when the Claude prompt `❯` is empty and no run is in progress. If a run is still going, wait for its report.
- **Send a run:** text with `-l` (literal), then `Enter` as a separate key:
  ```bash
  ssh mac-mini 'export PATH=/opt/homebrew/bin:$PATH; tmux send-keys -t dtrack -l "/clear"; sleep 1; tmux send-keys -t dtrack Enter; sleep 2; tmux send-keys -t dtrack -l "Read brief-<date>-<id>.md and run the device checks in it exactly as written. Write the report to the path the brief names. Stop and ask me whenever the brief says the user must act."; sleep 1; tmux send-keys -t dtrack Enter'
  ```
  `/clear` first, so one run's context doesn't leak into the next.
- **Wait for the report file**, not the pane: run
  `until ssh … 'test -s <report>'; do sleep 60; done` with `run_in_background`.
  Use `capture-pane` only to check progress, or to see whether the run is waiting for the user.
- **Steps the user must act on** (unsaved prompts, a title-bar click, typing on the
  console) happen in that same window. Tell the user what is coming before you send the run.

## 7. Failure → cause

| Symptom | Cause | Fix |
|---|---|---|
| `kex_exchange_identification: banner line 0: HTTP/1.1 403` | Traffic went into Clash TUN instead of Tailscale. Usually Tailscale was stopped | `tailscale up`. Clash should exclude `100.64.0.0/10` (see below) |
| `Host key verification failed` | First connection, so the key isn't in `known_hosts` | The alias already sets `accept-new`. For a raw IP add `-o StrictHostKeyChecking=accept-new`. Before trusting the key, compare `ssh-keygen -lF <host>` with `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` run on the remote |
| `REMOTE HOST IDENTIFICATION HAS CHANGED` | The key changed | **Do not auto-fix.** Ask the user. Run `ssh-keygen -R <host>` only after they confirm the remote was reinstalled |
| `Permission denied (publickey,password,…)` | Wrong user (the local `jackcheng` ≠ the remote `jack`), or the key isn't authorized | Use the alias. Otherwise check `~/.ssh/authorized_keys` on the remote |
| `Could not resolve hostname jacks-mac-mini` | MagicDNS is blocked (Clash `dns-hijack`) | Use the IP from `tailscale status` |
| `command not found: pnpm` / `cargo` | Non-interactive PATH | `export PATH=/opt/homebrew/bin:$PATH;` (see §2) |
| Whole command denied, even the ssh part | One segment matched a deny rule (e.g. `scp`) | Split it, and use `rsync` (§3–4) |

## Clash coexistence

Clash Verge Rev runs a TUN (`utun1`, gateway `198.18.0.1`). The tailnet CGNAT
range is kept out of Clash in two places, both under
`~/Library/Application Support/io.github.clash-verge-rev.clash-verge-rev/profiles/`:

- Global `Merge.yaml` sets `tun.route-exclude-address: [100.64.0.0/10]`. This is
  the main fix: the range never gets a Clash route, in any mode.
- The subscription's 「编辑规则」 file (`rOlpyyGLEMXK.yaml`) has
  `prepend: IP-CIDR,100.64.0.0/10,DIRECT,no-resolve`. This is the fallback in
  rule mode. It is per-subscription, so add it again after switching
  subscriptions. `prepend-rules` inside `Merge.yaml` is ignored by Verge 2.5.6.

To verify, grep the generated `clash-verge.yaml` in that folder for
`100.64.0.0/10`. It should appear under `tun:` and at the top of `rules:`.
Full write-up: `docs/reference/clash-tailscale/clash-verge-tailscale-complete-guide.md`.

## Rules

- Never pass `StrictHostKeyChecking=no`. Never delete `known_hosts` entries without asking.
- **Rule 25 applies on the remote too.** Confirm destructive commands (`rm -r`,
  `git reset --hard`, …) before running them over SSH, exactly as you would
  locally.
- Never copy `~/.mdpro` or `~/.claude` to a remote wholesale.
- Never push redesign branches to `origin` to get them onto the mini (use §5).
- Never edit permission settings to unblock a remote command. Ask the user.
- GUI device checks run only in the user's `dtrack` tmux session (§6). Never open
  extra Terminal windows for them, and never kill or recreate `dtrack` from SSH.
