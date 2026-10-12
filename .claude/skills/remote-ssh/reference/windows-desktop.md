# Windows host `win-desktop` over Tailscale: remote SSH and device tests

Reference for the `remote-ssh` skill. The main `SKILL.md` is written for the
Mac mini; this file lists everything that is **different** on the Windows
desktop. Where this file is silent, `SKILL.md` applies (preflight, Clash
coexistence, permissions, rule 25 on the remote, the host-key rules).

Full setup story, including the one-time Windows-side steps the user runs and
the feature-ledger audit method: `docs/guide/tailscale-windows-mdpro-audit-guide.md`.

## 1. The host

| | Local (MacBook) | Remote (`win-desktop`) |
|---|---|---|
| Tailnet name / IP | — | `desktop-home` → `100.123.111.19` (the user calls it `desktop-7576am2`, its hostname) |
| User | `jackcheng` | `jack` (member of Administrators) |
| Shell over SSH | zsh | **Windows PowerShell 5.1** (`HKLM:\SOFTWARE\OpenSSH\DefaultShell`), not cmd, not pwsh 7 |
| sshd | — | OpenSSH for Windows 9.5, system service |
| Host key | — | ed25519 `SHA256:XGEIP0iWtBBw9XQgnKaK1nmOMHQuU/xxfqQRw/TnfzA` |
| git | `/opt/homebrew/bin/git` | `D:\programs\Git\cmd\git.exe` (Git for Windows, so Git Bash exists) |
| node | pnpm-managed | `C:\Program Files\nodejs\node.exe` |
| claude | — | `C:\Users\jack\.local\bin\claude.exe` (native install) |
| mdpro | main checkout | **not installed** as of 2026-10-12; installer is `mdpro_<ver>_x64-setup.exe` from the GitHub release |
| mdpro log | `~/.mdpro/mdpro.log` | `%USERPROFILE%\.mdpro\mdpro.log` |
| MCP port/token files | `~/.mdpro/` | `%APPDATA%\mdpro\server.port`, `server.token` |
| OS | macOS | Windows 11 build 26200 |

Alias in `~/.ssh/config` (already present on the MacBook):

```
Host win-desktop
    HostName 100.123.111.19      # MagicDNS `desktop-home` fails under Clash's DNS hijack, so the IP
    User jack
    IdentityFile ~/.ssh/id_ed25519
    StrictHostKeyChecking accept-new
```

Permission rule the user must add for the alias to run unprompted:
`Bash(ssh win-desktop *)`. Don't edit settings yourself.

## 2. Connect

```bash
ssh -o BatchMode=yes -o ConnectTimeout=10 win-desktop 'hostname; whoami; $PSVersionTable.PSVersion.ToString()'
```

Expected: `DESKTOP-7576AM2`, `desktop-7576am2\jack`, `5.1.26100.…`.

### PowerShell quirks (the remote shell is PowerShell, not zsh)

- **Single-quote the whole remote command** locally, as for the mini. Inside
  it, `$env:USERPROFILE`, `$input`, `$PSVersionTable` are PowerShell, and are
  only safe because the local shell did not expand them.
- Paths use `\` and drive letters; forward slashes work in most cmdlets but
  not in every external tool. Quote paths with spaces using double quotes
  inside the single-quoted command: `'& "C:\Program Files\nodejs\node.exe" -v'`.
- `&` is the call operator for a quoted executable path. `;` separates
  statements. There is no `&&` in PowerShell 5.1; use `; if ($?) { … }`.
- `Get-Command git,node,claude | Select-Object -ExpandProperty Source` is the
  inventory one-liner.
- Windows-side text files written by `Set-Content` default to the system
  code page, not UTF-8. Add `-Encoding UTF8` for markdown; ASCII only for
  `administrators_authorized_keys` (sshd rejects a BOM).
- **CRLF.** A clone on Windows needs `git config core.autocrlf false`; the
  repo's `.gitattributes` enforces LF. A wall of `modified` after a pull is
  line endings, see `docs/guide/cross-platform-wsl.md`.

### Key login on an admin account

`jack` is in Administrators, so sshd reads
`C:\ProgramData\ssh\administrators_authorized_keys` **only**;
`C:\Users\jack\.ssh\authorized_keys` is ignored. The file must be a file (on
2026-10-12 it had been created as a directory, which is why key login failed
for a day), ASCII, one key per line, ACL `SYSTEM:(F)` and
`BUILTIN\Administrators:(F)` via `icacls`. The pre-fix directory survives as
`administrators_authorized_keys.dir-backup`; delete it only with the user's word.

## 3. File transfer: no rsync, no scp

Windows has no rsync and `scp` is denied repo-wide. Use ssh pipes, one
transfer per command, never chained with anything else:

```bash
# Mac → Windows (small text files, e.g. a brief)
ssh win-desktop 'Set-Content -Encoding UTF8 -Path C:\Users\jack\brief.md -Value $input' < brief.md
# Windows → Mac (a report)
ssh win-desktop 'Get-Content -Raw -Encoding UTF8 C:\Users\jack\report.md' > report.md
```

Anything large (the installer, the repo) the Windows side fetches itself from
GitHub. Never pipe `~/.mdpro` or `~/.claude` across in either direction.

## 4. Long remote jobs

`ssh win-desktop '<cmd> *> C:\Users\jack\job.log'` with Bash
`run_in_background`; PowerShell's `*>` redirects every stream. Wait for the
completion notification, don't poll.

## 5. Headless Claude on Windows over SSH

```bash
ssh win-desktop '& "$env:USERPROFILE\.local\bin\claude.exe" -p --bare --output-format json --allowedTools "Read,Grep,Glob" --permission-prompts none "<prompt>" > C:\src\out.json'
```

- An SSH session may not see the desktop OAuth login; `--bare` needs
  `ANTHROPIC_API_KEY` in the session, or run from the console instead. This
  path is **unverified** as of 2026-10-12.
- Without `--permission-prompts none` and `--allowedTools`, `-p` hangs on the
  first permission prompt.
- Only read-only audit layers (ledger check, per-section reads) belong over
  SSH; anything that needs the mdpro window does not (§6).

## 6. Device tests on Windows

Same rule as the mini: **GUI checks run only from a Claude started on the
Windows console session**, never from SSH. An SSH process has no desktop, so
screenshots, keystrokes and Computer Use fail or hit the wrong window.

What differs from the mini:

- There is **no `dtrack` tmux session on Windows** and no tmux. Until the
  user sets up a console-side session, a device brief is delivered as a file
  (§3) and the user runs it in their own Claude on the Windows desktop. Don't
  try to start one over SSH.
- The brief names Windows paths: the fixture copy goes under
  `%USERPROFILE%\mdpro-dtrack\`, the log line to grep is in
  `%USERPROFILE%\.mdpro\mdpro.log`, the report comes back by the §3 pipe.
- Platform triage is part of every result. A row that says
  `平台不适用` (macOS-only: native menu, `⌘` shortcuts, `.dmg` updater,
  Quick Look) is not a failure. The ledger's 「Windows 构建」 row is
  `Unknown`; a Windows device run is the first evidence for it.
- Steps that need a human at the keyboard (SmartScreen on the installer,
  first launch, Computer Use grant) go in the brief ahead of time, as on the
  mini.
- Computer Use availability for the mdpro window on Windows is **unverified**.

## 7. Failure → cause (Windows additions)

| Symptom | Cause | Fix |
|---|---|---|
| `Permission denied (publickey,password,keyboard-interactive)` | Admin account: key not in `administrators_authorized_keys`, or that path is a directory, or wrong user | §2; `ssh -v` shows `Offering public key` with no `Authentication succeeded` |
| Key present, still denied | ACL on `administrators_authorized_keys` too open; sshd ignores it silently | Re-run the `icacls` lines in the guide §2.2 |
| Remote quoting garbled, `$env:` printed literally | DefaultShell still cmd | Guide §2.3 |
| `Could not resolve hostname desktop-home` | Clash DNS hijack | Use the IP alias |
| Whole command denied by Claude Code | A segment matched a deny (`scp`), or `;`/`&&` chain | One command per call |
| `claude -p` reports no auth | SSH session can't reach desktop login | Console session, or `ANTHROPIC_API_KEY` |
| Mass `modified` after clone/pull | CRLF | `git config core.autocrlf false` |

## Rules (in addition to SKILL.md § Rules)

- Never `StrictHostKeyChecking=no`; compare the fingerprint above before
  trusting a changed key, and never `ssh-keygen -R` without the user.
- One ssh command per Bash call. No `scp`, no rsync (there is none).
- Never write to `C:\ProgramData\ssh\` from the MacBook; that is the user's
  one-time setup.
- Rule 25 applies on Windows: `Remove-Item -Recurse`, `git reset --hard`,
  `git clean` over SSH need the user's confirmation first.
