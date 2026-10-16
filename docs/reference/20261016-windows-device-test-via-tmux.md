# Windows device tests run by a Claude on the PC, in a tmux-style session (feasibility, 2026-10-16)

**Asked by the user (2026-10-16):** 「目前windows device test，通过ssh比较慢，能否参考mac mini device test，在Windows中开启 tmux，然后让Windows中claude来测试，测试完报告回来。你评估一下可行性，必要的时候网上搜索」

**Decision so far:** run a trial after v0.3.5 ships. The user picked 「Trial after v0.3.5 (Recommended)」.

**Status:** Proposed. Once the trial is done, its result becomes an ADR and a rule 70 row. Until then this file is the record.

**Written by:** mdpro-delegator. Facts about the PC come from SSH probes run on 2026-10-16 (§ 2). Claims about outside tools cite their sources (§ 7).

## 1. Short answer

**Feasible.** The PC already runs Claude Code, and today's Windows checks don't move the mouse; they drive the app through WebView2's debugging port 9222 with node scripts. That means a Claude on the PC can run the same scripts locally, and nobody needs Computer Use on Windows.

The missing pieces are:
- a tmux equivalent: **psmux**, a native Windows multiplexer that speaks the tmux command language;
- a hook push back to the MacBook, the same as dtrack's;
- a role and a rule 70 row for the new session.

The one unknown is whether psmux can be driven from an SSH login when the session itself lives in the desktop's console session. That is § 5 step 3, the first thing the trial checks.

**Expected gain: about 2–3× on wall-clock time, not 10×.** That is an estimate, not a measurement. Most of a run is the model reading, thinking and taking screenshots. What goes away is the per-step overhead:
- a fresh PowerShell for every SSH call (each one about 1–2 s);
- the scheduled-task trampoline that launches mdpro into the desktop session;
- copying files between machines.

## 2. What the PC has today (probed 2026-10-16)

| Item | Value |
|---|---|
| Host | `win-desktop` (`desktop-7576am2\jack`), Windows NT 10.0.26200 (Windows 11), PowerShell 5.1.26100 |
| Logged-in user | `jack`, **console session 1, Active**. mdpro must start in this session for its window to be on screen |
| Claude Code | `C:\Users\jack\.local\bin\claude.exe`, **2.1.299**; `~\.claude\.credentials.json` and `~\.claude.json` both present |
| Tailscale | installed, `100.123.111.19` |
| Tooling | `curl.exe` (system32), node (`C:\Program Files\nodejs`), git (`D:\programs\Git`), winget |
| WSL | Ubuntu installed |
| tmux / psmux | **not installed** |
| mdpro | per-user install at `D:\programs\mdpro`. How it's launched today: SSH calls the `mdpro.sh` helpers, which start it through an `mdpro-audit-*` scheduled task so it lands in session 1. The 9222 port opens only in test mode |

## 3. Today's path, and where the time goes

```
MacBook session (codex-audit or the delegator)
  └─ ssh win-desktop  ── one new PowerShell per step
       ├─ schtasks → mdpro in session 1 (test mode, 9222)
       ├─ node cdp.mjs … (DOM reads, key events, page shots)
       └─ results copied back to the MacBook and read there
```

Every step is a round trip through SSH and a cold PowerShell. A brief with 40 steps pays that cost 40 times. The deciding session also holds the whole run in its own context, which is why the codex-audit session gets slow and expensive on long Windows runs.

## 4. Proposed path

```
MacBook (mdpro-delegator)
  ├─ ssh win-desktop "psmux send-keys -t wtrack …"   ← brief in, the same routine as dtrack
  ├─ hook receiver ← Stop / Notification events from the PC (curl.exe over Tailscale)
  └─ reads the report file (scp), never a message
PC, console session 1
  └─ psmux session "wtrack"
       └─ claude.exe (role: windows device tester)
            ├─ starts mdpro directly (it's already in session 1)
            ├─ node cdp.mjs … locally
            └─ writes reports\report-<date>-<id>.md
```

It mirrors dtrack's arrangement, as rule 70 § The Mac mini lays it out:
- the brief goes in by `send-keys`;
- the wait is on hook events, not on polling the screen;
- `capture-pane` only answers "which prompt is it sitting on";
- the report is read from a file;
- only mdpro-delegator's messages count as briefs.

### What carries over unchanged

- The briefs' layout: build line, cells, failure condition, the log line that proves the path was reached. Teardown and config snapshot and restore stay as they are.
- The CDP scripts and the WI-4 driver under `scripts/device/` and the Windows helpers.
- `wait-dtrack.sh` / `last-dtrack.sh`, generalised to take the tester's name.

### What is new

| Piece | Work |
|---|---|
| psmux | `winget install psmux`. It ships `psmux`, `pmux` and `tmux` binaries, reads `.tmux.conf`, and uses ConPTY |
| Session start | `wtrack` must start in console session 1. Either the user starts it once at the PC, or a logon scheduled task (interactive) runs `psmux new -d -s wtrack claude` |
| Repo on the PC | a checkout to read briefs and scripts from, updated by `git pull` from origin. Read-only for the tester |
| Hooks | `.claude/settings.json` on the PC: `Stop` and `Notification` hooks that `curl.exe` the MacBook receiver with the token header. The receiver's allowlist gains `100.123.111.19`. The token stays a secret: never printed, never committed |
| Role guard | `MDPRO_ROLE=windows-device-tester`. `role-guard.sh` runs under Git Bash, which Claude Code on Windows already uses. Same limits as `real-device-tester`: no state-changing git, writes only to the report and scratch directories |
| Permissions | an allowlist in the PC's project settings (node, the helper scripts, reading logs, writing reports), so the run doesn't stop on prompts nobody can answer |
| Rule 70 | a row in § Sessions and an alias entry for `wtrack` |

## 5. Trial plan (after v0.3.5; about 30–45 min)

1. **Install** psmux with winget (`--scope user` if winget offers it). Record its version.
2. **Start** a `wtrack` session in console session 1 with a plain shell first, not claude.
3. **Decisive check: from an SSH login, can we drive it?**
   - `psmux ls`, `psmux send-keys -t wtrack "echo hi" Enter`, and `psmux capture-pane -pt wtrack` must work. They are named-pipe calls that cross from the SSH session to session 1.
   - **If they fail, stop here** and fall back to Appendix A.
4. **Start claude in it**, with the role set, and check that its child processes land in session 1. Start notepad and confirm its window appears on the PC's screen.
5. **Hook push:** a `Stop` event reaches the MacBook receiver, and `wait-dtrack.sh -e` sees it, renamed or parameterised.
6. **Dry brief (5 min):** start mdpro in test mode, read `app.ready`'s `releaseId` over CDP, take one page shot, write a report, quit mdpro cleanly. Time it against the same steps over SSH.
7. **Record it:** an ADR (accepted or rejected, with the timings), the rule 70 row, and this file's status.

**Failure conditions:**
- step 3 fails;
- the child processes don't land in session 1;
- hooks don't arrive;
- the dry brief isn't faster than the SSH path.

Any one of them means we keep the SSH path, or try Appendix A, and the ADR records the rejection.

## 6. Risks and costs

| Risk | Note |
|---|---|
| psmux across sessions | Unverified, and the reason step 3 comes first |
| Account usage | The tester uses the same subscription as dtrack and the MacBook sessions. On 2026-10-15 dtrack's weekly budget was at 91%. A second tester session spends the same pool |
| Permission prompts | Nobody sits at the PC. The allowlist must cover a whole brief, or the run stalls. dtrack's Computer Use grant rule does not apply here, because Windows runs need no Computer Use |
| Physical keys | Some cases need real hardware keys, such as a physical Esc (D240 M2) or an IME. They still need the user at the PC, as today |
| Two drivers on one PC | Only one session drives the PC at a time. While `wtrack` exists, codex-audit stops driving Windows over SSH except for setup and teardown that the brief names |
| psmux maturity | A young project; version numbers differ between sources. Pin the version we tested |
| Secrets | The MCP token and the hook token stay on the PC and are never printed. Snapshots that contain the MCP token are deleted after the run, as today |

## 7. Sources

- psmux: <https://github.com/claydugo/psmux>, mirrored as `marlocarlo/psmux`. Its docs at docs.rs show versions 0.1.0–0.4.8. Review: <https://korben.info/en/psmux-native-tmux-windows-no-wsl.html>
- Claude Code Remote Control: <https://www.datacamp.com/tutorial/claude-code-remote-control> (secondary source; check Anthropic's docs before relying on it)
- The other options in Appendix A: <https://www.thewindowsclub.com/use-claude-code-and-openai-codex-remotely-in-windows>, <https://esegece.com/products/apps/sgcclaudecoderemote>
- mdpro's own conventions: `.claude/rules/70-multi-session-coordination.md` § The Mac mini, and `~/.mdpro-redesign/hooks/` (the receiver, `wait-dtrack.sh`, `last-dtrack.sh`)

---

## Appendix A. Other options considered

| # | Option | How | Works for | Against | Verdict |
|---|---|---|---|---|---|
| A1 | **psmux on Windows** (this proposal) | native tmux-compatible multiplexer, `send-keys` over SSH | closest to dtrack, so the briefs and helpers carry over | cross-session reach unverified; young project | **Trial first** |
| A2 | **tmux inside WSL** running `claude.exe` by interop | `wsl tmux new -s wtrack 'claude.exe'` | tmux is mature; `send-keys` is proven | a Windows terminal program inside a Linux pty has known rough edges. Children start from the WSL session, so mdpro may not land on the desktop. Paths cross two filesystems | Fallback if A1's step 3 fails, but likely to hit the session-1 problem |
| A3 | **Claude Code Remote Control** | start `claude` at the PC with Remote Control; the delegator sends briefs with `SendMessage`. `ListAgents` already lists Remote Control sessions from other machines | no multiplexer, no `send-keys` quoting, no hook plumbing for input | unverified whether a Remote Control session on another machine can message back. The report would still go to a file. Needs the user to start it at the PC each time it restarts | Second fallback; test its message-back in the same sitting |
| A4 | **Headless `claude -p` over SSH** | `ssh win-desktop claude -p "<brief>"` | no session to keep alive; output returns on stdout | runs in the SSH session, not session 1, so mdpro still needs the scheduled-task trampoline. No interactive prompts, so every permission must be pre-granted. A long brief is one fragile call | Good for short, scripted checks (e.g. "read releaseId"), not for briefs |
| A5 | **Keep SSH, cut the overhead** | one long-lived PowerShell over SSH (`ssh -tt` plus a FIFO), or batch a brief's steps into one script per section | no new session, no new account usage | still every decision crosses machines; the codex-audit context still grows with the run | Cheap improvement worth taking even if A1 lands |
| A6 | **Third-party web terminal** (for example sgcClaudeCodeRemote) | wraps Claude Code in a browser terminal on the PC | remote screen of the session | outside dependency, another listening port, nothing mdpro's rules know about | Rejected |
| A7 | **Computer Use on Windows** | Claude Desktop's Windows Computer Use | could press real keys on screen | not available in Claude Code on Windows as far as the sources show; Desktop is a different product; the CDP path already covers what we drive | Not needed |

## Appendix B. Open questions for the trial

1. Does psmux's server accept clients from another Windows session of the same user? This is step 3.
2. Does a claude started by a logon scheduled task inherit the user's credentials and PATH (the `~\.local\bin` install)?
3. Does a Remote Control session on the PC appear in the MacBook's `ListAgents`, and can it `SendMessage` back? This decides A3.
4. Where does the PC's report directory live, and how does the MacBook fetch it? `scp` over Tailscale, or a `git`-ignored folder in the PC's checkout.
