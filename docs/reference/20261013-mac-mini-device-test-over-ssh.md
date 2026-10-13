# Mac mini device tests over SSH, without a tmux-hosted Claude: a proposal for review

**Status:** proposal for review, **revision 2** (2026-10-13). Nothing built. Written by
mdpro-codex-audit at the user's request (「先把方案写进 docs/reference/ 供 review」), then revised at
the user's request (「revise the Mac mini plan to address the plan-review findings」) after a Codex
plan review (gpt-6.1-sol, high; thread `01a132e5-9e4f-7b82-a119-d8aa3f61a964`). Its verdict on
revision 1 was NEEDS REVISION, with 20 findings. § 10 maps each finding to where this revision
answers it. The question: like `remote-windows-device-test`, can the mini's device tests drop
`tmux capture` and drive the app with macOS scripts over SSH?

**Short answer:** probably yes for the native layer (menus, clicks, keys, screenshots), through a
small signed helper that launchd starts in the console user's GUI session, not `sshd`. **None of
that is proven on the mini yet.** TCC attribution, CGEvent delivery, AX on native panels and the
Screen Recording consent cadence are the spike's job (§ 7), and nothing past the spike is built
until it passes. The page layer (WKWebView) is out of scope: it needs ADR-0047's control channel,
which is still *Proposed*. dtrack stays.

## 1. What runs today

- **GUI device checks:** only real-device-tester runs them. That's a Claude in the tmux session
  `dtrack`, started from Terminal.app on the mini's console so that it inherits Terminal's
  Screen Recording and Accessibility grants. It uses computer use. The delegator sends briefs
  with `tmux send-keys` and reads reports from files (rule 70 § The Mac mini).
- **Hook events:** dtrack's Stop / Notification / SessionStart events are spooled on the mini
  and replayed to the MacBook receiver (ADR-0087). `wait-dtrack.sh` waits on them.
- **Drag tool:** `scripts/device/drag.swift` posts real CGEvent drags. It validates the whole
  plan first, caps waits, and releases held buttons on SIGINT/SIGTERM. `drag.sh install`
  compiles over SSH, but **a drag runs only in dtrack's own terminal**, because an SSH-started
  process has no Accessibility grant (exit 2).
- **Verify builds:** ADR-0047 provides an isolated verify build and a launcher
  (`scripts/control/*`, owned by mdpro-device-harness / adr047-verify). The launcher gives each
  run its own data directory and log, a lock (one verification run at a time), a build identity
  and proof of ownership. The in-app driver it would add has **not been chosen**, and ADR-0047
  is still *Proposed*.

**What dtrack costs:**
- Every brief starts with `/clear` and a Computer Use permission prompt.
- A second Claude can hold the computer-use lock.
- A read-only `tmux attach -r` viewer makes `send-keys` fail.
- Runs are slow and not repeatable, and results depend on how the tester reads the screen.

## 2. The constraint: macOS privacy permissions (TCC)

What we have **observed** on the mini, and what we are **assuming**:

- **Observed:** `screencapture`, System Events keystrokes, CGEvent posting (`drag.sh`, exit 2) and
  computer use all fail from SSH sessions, and work from Terminal.app on the console (remote-ssh
  skill § 6). That is an observation about those tools, not a proof that no SSH-started executable
  can ever hold a grant.
- **Assumed, to verify in the spike:** a signed `.app` whose Mach-O is started directly by a
  LaunchAgent in `gui/<uid>` is treated as its own responsible client by TCC. It then gets the
  Accessibility and Screen Recording grants made to it once at the console. Apple describes
  responsibility as heuristic (it follows bundle association and the launch chain), so this must
  be measured, not asserted. The spike records the identity TCC actually attributes, and probes
  AX, event posting and capture **separately**: one can pass while another fails.
- **Grants follow the code's designated requirement**, not the path. An ad-hoc signature's
  requirement is its cdhash, so a changed ad-hoc build usually loses its grants. A build signed
  with a stable identity, the same bundle ID and the same install path usually keeps them across
  updates. The spike checks both: an ad-hoc spike build, then a re-signed changed build.
- **Screen Recording consent is not "grant once" on recent macOS.** macOS 15 added periodic
  re-confirmation for screen capture, and 15.1 changed the policy for legacy capture APIs. The
  persistent-capture entitlement needs Apple's approval and is meant for VNC-type apps; we don't
  assume we'd get it. The cadence on the mini's macOS 26.x is **unknown**, and the design treats
  "permission needed" as an expected outcome (§ 4), not a crash.
- `launchctl asuser <uid> <cmd>` (option Y) runs a command in the user's GUI bootstrap namespace.
  It is **not** a documented change of TCC identity, and it doesn't import the user's
  environment. It stays an experimental spike variant.

## 3. Proposed design

```
MacBook (ssh) ──► mini: acquire the desktop lease; write request <id>.json atomically into inbox/;
                       `launchctl kickstart gui/<uid>/com.mdpro.device-agent`
                       │
                       ▼  launchd (console user's GUI session)
               MdproDeviceAgent.app (signed; TCC: Accessibility + Screen Recording)
                 claims the oldest request → preflight → runs its steps → writes <id>.result.json → exits
                       │
MacBook (ssh) ◄── polls for <id>.result.json (bounded); reads shots and the run's log; releases the lease
```

| Piece | Responsibility |
|---|---|
| `MdproDeviceAgent.app` | A small Swift binary in an `.app` bundle with a fixed bundle ID, installed at a fixed path, signed with one stable identity. Runs one request, then exits. **No idle process, no listener, no socket.** Operations in § 3.4. |
| LaunchAgent `~/Library/LaunchAgents/com.mdpro.device-agent.plist` | `ProgramArguments` = the bundle's Mach-O directly (no shell or interpreter wrapper, which would change the attributed identity). Fixed arguments: the spool directory only. `RunAtLoad false`, no `KeepAlive`, no sockets. Installed **and registered** by `install.sh` (§ 3.6), not just copied. |
| Spool `~/.mdpro-device/` (mode 700) | `inbox/`, `claimed/`, `results/`, `shots/`, `lease`. |
| Mac-side wrappers | Same shape as `remote-windows-device-test/scripts/mac` (`ui.sh`, `log.sh`, `pull.sh` through `rsync`). Skill name: open question 4. |
| Page layer | **Not covered by the agent.** WKWebView exposes no CDP. SafariDriver automates Safari, not third-party WKWebViews. Safari Web Inspector *can* inspect a third-party WKWebView whose build sets it inspectable, but that is not an automation endpoint. Page state comes from ADR-0047's probes once its driver exists. Until then the agent only reads what the AX tree exposes (`AXWebArea` text, button presses), and records that as partial. |

### 3.1 Which app it drives: verification runs only

The agent drives **only an mdpro verification run started by ADR-0047's launcher**. It never
drives the installed mdpro, which holds the user's real documents and `~/.mdpro`.

- Every request names the launcher's **run id**. Before any input, the agent checks:
  - the run is live: the launcher's manifest reports it running;
  - the target PID belongs to it: the PID and process start time match the manifest;
  - the executable is the verify bundle: the bundle ID, path and build identity match.

  If any check fails, the request is refused as `rejected: target`.
- Logs and evidence come from **the run's own directory**, never `~/.mdpro/mdpro.log`.
- Fixtures are copied into the run directory (the CLAUDE.md "run on a copy" rule).
- A production smoke test of the installed app, if ever wanted, is a separate mode with its own
  fixture and document-safety rules. It is out of scope here.

### 3.2 Request and result protocol

- **One request per run, with a unique id** (`<UTC timestamp>-<random>`).
  - The MacBook writes `inbox/<id>.json.tmp`, then renames it to `inbox/<id>.json`; a rename is
    atomic, so the agent never sees a half-written request.
  - The agent claims a request by renaming it into `claimed/`, and appends its status to
    `results/<id>.status`: `claimed → running → done | failed | rejected | cancelled`.
  - The final result is written as `results/<id>.result.json` (tmp + rename). The result carries
    the request id, and the wrapper refuses a result whose id doesn't match.
- **Kickstart is only a doorbell.** `launchctl kickstart` returns at once. If the job is already
  running, it returns that job's PID and starts nothing. So:
  - the wrapper never treats kickstart's success as execution;
  - it never uses `-k`, which kills a running job mid-input;
  - the agent drains `inbox/` before it exits, so a request that arrives while it is running is
    still served.
- **Versioned schema.** `{"schema":1,"id","runId","deadlineMs","steps":[…]}`.
  - Validation: an unknown op, a missing field, an out-of-range value or a deadline over the cap
    rejects the **whole request before any input**, as `drag.swift` already does.
  - Execution: the first failing step stops the run, and later steps are reported `skipped`. This
    deliberately differs from the Windows ops, which log an error and continue.
- **Outcomes** follow ADR-0047 Decision 8: `pass`, `fail`, `driver failure`, `unknown outcome`,
  `NOT VERIFIED`, plus `rejected` (never started) and `permission needed` (a TCC check failed, with
  which grant). A mutating request whose result never arrives is an **unknown outcome**: it is not
  retried automatically, and a late result doesn't change the verdict.
- **SSH loss** doesn't lose the result: it stays in `results/` and the wrapper reads it on
  reconnect. Notifications, if added later, carry the request id. They are never presented as
  Claude hook events.

### 3.3 One controller at a time: the desktop lease

launchd only serialises this one job. dtrack, the launcher and the user can all still reach the
desktop. The lease covers a **whole journey** (all requests of one check), not one request.

- `~/.mdpro-device/lease` holds `{holder, journey, pid, startedAt, expiresAt}`. It is created with
  an atomic create-if-absent and renewed by the holder.
- Every controller takes it: the agent's wrappers, and dtrack too (a line in every brief: acquire
  before the first GUI action, release in the report step). A request whose journey doesn't hold
  the lease is rejected.
- An expired lease may be broken only after checking that its holder's PID is gone. Breaking it is
  logged. The lease never overrides a live holder.
- The user at the console is not a controller the lease can stop. The agent checks that the
  console is unlocked and that the target window is frontmost before each input step (§ 3.5).

### 3.4 Operations (bounded, explicit, typed errors)

| Op | Notes |
|---|---|
| `windows` | AX windows of the target PID only: title, role, subrole, position, size, minimized, focused. |
| `activate` / `unhide` / `unminimize` / `raise` | Four separate ops. They are not interchangeable: raising a window doesn't activate or unhide its app, and unminimizing doesn't undo app Hide. |
| `geometry {x,y,w,h}` | Sets `AXPosition` and `AXSize`, then reads them back. A mismatch fails the step. This replaces "maximize": macOS zoom is not a portable maximize, and `AXZoomed` is not a standard attribute. The original geometry is saved and restored at the end. |
| `menuclick ["View","Source"]` | Walks the AX menu bar of the target app by title path, opens each level (submenus load lazily), checks `AXEnabled`, then `AXPress`. Typed errors: `not-found`, `disabled`, `press-failed`. `menus` dumps the tree with key equivalents. |
| `clickat` / `drag` | CGEvent in **global display points**. Folds in `drag.swift`'s plan validation, wait caps and signal-time release. |
| `chord` | CGEvent key down/up with flags. Keys come from a **named table** (letters, digits, punctuation, F-keys, arrows), and the input source must be ABC (preflight). Every modifier and button pressed is tracked, and all are released on success, failure, deadline or signal. Not a text-entry API: text goes in through `typetext` (AX value set or paste), and IME stays manual. |
| `panel.open` / `panel.save` | A state machine over the panel owned by the target PID: wait for the panel → ⇧⌘G → set the path field → confirm → (save) handle the overwrite sheet → wait for the panel to close. Every transition has a deadline and a typed error. The spike proves it on a CJK path before it is relied on. |
| `shot window\|screen` | ScreenCaptureKit (`SCScreenshotManager.captureImage`, macOS 14+) only. `CGWindowListCreateImage` can't be used: the macOS 15 SDK marks it obsolete. Writes a PNG, then verifies it decodes and isn't blank. A permission denial is reported as `permission needed`, not inferred from the image. |
| `tree` | AX tree of the target window, depth- and size-capped. |
| `assert` | Bounded wait for a condition: an AX value, a window title, or a log event **in the run's log after a mark**. This is what `wait` was missing. |

**Coordinates:** points, with the display ID and origin taken from `CGDisplayBounds`. `shot` records
the scale factor and the crop origin, so a pixel in a screenshot maps back to a point. The mini is
1920×1080 at @1x today, but the conversion is written for any scale.

### 3.5 Preflight, every run

The agent checks each of these before the first step and refuses with a named reason:

- a console user is logged in, and the session is **unlocked** (`CGSessionCopyCurrentDictionary`);
- a display is online;
- `AXIsProcessTrusted()`, **plus** an event-posting check (`CGPreflightPostEventAccess`);
- `CGPreflightScreenCaptureAccess()` when the request has a `shot`;
- the input source is ABC when the request has a `chord`;
- the target checks in § 3.1;
- the lease in § 3.3.

Sleep: the wrapper runs `caffeinate -u -t <journey deadline>` for the journey's duration.

### 3.6 Install, upgrade, uninstall

`install.sh` (idempotent; run over SSH, except the grant):
1. Copy the signed bundle to its fixed path. Refuse if the signature or bundle ID differs from the
   pinned designated requirement.
2. Write the plist. Then `launchctl bootout gui/<uid>/com.mdpro.device-agent` (ignore "not
   loaded"), `launchctl bootstrap gui/<uid> <plist>`, `launchctl enable …`.
3. `launchctl print gui/<uid>/com.mdpro.device-agent` must show the job loaded, with the expected
   program path.
4. Run a `preflight-only` request and print which grants are missing. The user grants them at the
   console, once per signing identity (System Settings → Privacy & Security). Also check that the
   agent isn't disabled under Login Items & Extensions → background items.

Upgrade: the same script with a re-signed bundle; grants should survive (verified in the spike).
Uninstall: `bootout`, remove the plist, the bundle and the spool. Removing the spool needs rule 25
confirmation. **Steady state:** the job stays registered, and no agent process runs between
requests.

### 3.7 Success oracles and evidence

- **Every check names a state change and asserts the result.** Example: put the run into
  WYSIWYG first, mark the log, `menuclick View→Source`, then `assert` both that the log has
  `menu.view.set_mode` after the mark **and** that the mode is now Source. The log line alone only
  proves the handler was dispatched (`useMenuEvents.ts:189` logs it before the mode changes).
  Clicking Source while already in Source proves nothing.
- **A failure verdict needs a passing control on the same route** (Windows pitfalls).
- **Evidence classes** (ADR-0047 Decision 8): AX activation, injected CGEvent input, launcher or
  probe state, and physical input are recorded separately. Injected keys never discharge the
  physical-key rule in `progress.md`. IME and dialog keyboard behaviour stay manual.
- **Empty output is a transport failure**, never a result. **No full-screen shot is committed.**

## 4. Security: what the helper does and doesn't restrict

Revision 1 rejected option X ("grant `sshd-keygen-wrapper`") because any SSH session could then
read the screen and inject input. **The helper doesn't change who can ask.** Any SSH key that logs
in as `jack` can write a request and kickstart the job. A code signature restricts which code
runs, not who asked for it. What the helper does restrict:

- **What:** a fixed set of typed operations. No shell, no `eval`, no arbitrary AppleScript.
- **On what:** only a verification run that the launcher proves it owns (§ 3.1). Never the
  installed app, never another app.
- **Where outputs go:** only the spool directory.
- **When:** only while the caller holds the lease and the session is unlocked.

`clickat` plus `chord` is close to arbitrary input **inside the target window**, so this is
containment, not authentication. **Trust boundary, stated plainly: every SSH key authorised for
`jack` on the mini is trusted to drive the verify build's window.** If that is too broad, the fix
is an account boundary (a separate user, or a forced command on a dedicated key), not file modes
or a token. The ADR records this choice either way.

## 5. What it would change

- **Rule 70:** "only real-device-tester runs GUI tests" becomes "GUI checks run through dtrack
  **or** the device agent, one controller at a time under the desktop lease". The delegator still
  owns the queue. dtrack stays for checks that need judgement (visual quality, reading prose,
  unscripted exploration), and as the fallback until scripted journeys qualify (§ 6, M4).
- **remote-ssh skill § 6 and its Rules** ("GUI device checks run only in `dtrack`") change in the
  same commit as rule 70, together with the dtrack brief template (lease lines) and the
  device-check evidence rules. Changing one without the others leaves them contradicting each
  other.
- **Ownership:** the agent is device-test tooling on the mini, so it belongs to
  mdpro-device-harness (adr047-verify), not to this session.
- **An ADR** records the TCC-granted helper, the trust boundary in § 4, and the lease.

## 6. Milestones (each gates the next)

| | Milestone | Done when |
|---|---|---|
| **M0** | Spike (§ 7) | Every pass criterion met, or the result is written up and the plan stops |
| **M1** | Contract | § 3.1–3.3 written as schemas and tested on the MacBook with a fake target: atomic claim, stale-result refusal, busy kickstart, malformed request, SSH drop after a mutation (→ unknown outcome), lease break |
| **M2** | Native ops | § 3.4 ops on the verify build, each with a passing control and a negative test. Interruption tests: SIGTERM and SIGKILL mid-chord and mid-drag, then check that no modifier or button is left down |
| **M3** | Wrappers and reporting | The skill, the install script, and the rule 70 / remote-ssh / brief changes in one commit, plus the ADR |
| **M4** | Qualification | One real device-check batch run both ways (agent and dtrack) with matching verdicts, before any check drops dtrack |

Page-layer automation is tracked under ADR-0047, not here.

## 7. Spike (about a day, adr047-verify), with pass/fail criteria

1. **Build** a minimal `MdproDeviceAgent.app` (ad-hoc signed first) with: `preflight`,
   `shot screen` (ScreenCaptureKit), `menuclick`, `menus`, `clickat`, `chord`, a 50-point `drag`,
   and `panel.open`.
2. **Install** with `bootstrap` + `enable`. **The user grants** Accessibility and Screen
   Recording at the console. Record exactly how the app appears in each Privacy pane (name, path,
   bundle ID).
3. **From the MacBook over SSH**, against a verify-build run started by the launcher (the target
   check in § 3.1 can be a stub in the spike, but the run must be the verify build):
   - **Pass:** `preflight` reports all grants, including event posting.
   - **Pass:** the screenshot decodes and shows the mdpro window's content.
   - **Pass:** starting in WYSIWYG, `View → Source` changes the mode (`assert` on state) and the
     run's log has `menu.view.set_mode` after the mark.
   - **Pass:** `clickat` places the caret (observed through AX), a `chord` (⌘B on a selection)
     changes the document, and the `drag` moves a selection. **CGEvent delivery is tested here, not
     after the build-out.**
   - **Pass:** `panel.open` opens a fixture under a CJK-named folder.
   - **Pass:** a busy kickstart (a second request while one runs) is served by the drain, and
     nothing is killed.
   - **Pass:** no agent process remains afterwards; the job stays registered.
4. **Variant Y:** repeat the `preflight` and `shot` steps under `launchctl asuser` from SSH.
   Record the result; it doesn't change the design unless it is clearly better.
5. **Re-sign test:** change the code, re-sign with a stable (non-ad-hoc) identity, reinstall. Do
   the grants survive?
6. **Consent cadence:** repeat preflight after a reboot (with the console logged in again), after
   24 h, and at 7 days. Record the OS build, the capture API, and whether each prompt was a
   notification or blocked capture. **24 h is a smoke test, not a reliability claim.**
7. **Fail conditions** (the plan stops, and dtrack stays as it is):
   - Any grant is still denied to the kickstarted agent.
   - CGEvent input doesn't reach the target.
   - Screen Recording asks again so often that unattended runs aren't practical.

## 8. Alternatives considered

| Option | Why not (or not alone) |
|---|---|
| **X. Grant Accessibility + Screen Recording to `sshd-keygen-wrapper`** | Every SSH session, and every command it runs, gets the full grants: anything, on any app. The helper has the same callers (§ 4), but limits the operations, the target and the outputs. |
| **Y. `launchctl asuser <uid> <cmd>` from SSH** | Changes the bootstrap namespace, not the documented TCC identity. Tested as a spike variant (§ 7.4). |
| **Z. `osascript` / System Events from a LaunchAgent** | Needs Automation consent for each target app, plus Accessibility. UI scripting is slow and brittle, and it can't capture the screen. |
| **Keep dtrack only** | Works today and handles judgement-heavy checks, but keeps every cost listed in § 1. |
| **Computer use from the MacBook through Screen Sharing / VNC** | Takes over the MacBook's screen (the user rejected this on 2026-10-12) and is the slowest route. |

## 9. Open questions for the user

1. Is it OK to have a TCC-granted helper on the mini that drives the verify build's window when
   asked over SSH, with the trust boundary in § 4 ("every SSH key for `jack` is trusted")? Or
   should it get its own account or key?
   **Answered 2026-10-13: yes.** The user's word: 「yes」. The § 4 trust boundary stands: no
   separate account or key. The ADR records it.
2. Should adr047-verify run the § 7 spike? This goes through mdpro-delegator.
3. Does dtrack stay for judgement-heavy checks and as the fallback until M4? The proposal assumes
   yes.
4. Should the skill be a new `remote-mac-device-test` or a section of `remote-ssh`?

## 10. Review findings → this revision

Codex's 20 findings on revision 1 (BLOCK / MUST / SHOULD / NOTE as it labelled them):

| # | Sev | Finding (short) | Answered in |
|---|---|---|---|
| 1 | BLOCK | Which app is targeted; which log is evidence | § 3.1 |
| 2 | MUST | The helper doesn't restrict callers | § 4 (trust boundary stated), § 9 Q1 |
| 3 | SHOULD | "Resident" vs "exits"; "no job left behind" | § 3 table, § 3.6 steady state |
| 4 | BLOCK | Fixed files, no ids; kickstart semantics | § 3.2 |
| 5 | BLOCK | No lease shared with dtrack | § 3.3, § 5 |
| 6 | MUST | Install/bootstrap; locked or asleep session | § 3.5, § 3.6 |
| 7 | MUST | Interruption; held keys | § 3.4 `chord`/`drag`, § 6 M2 |
| 8 | MUST | TCC attribution stated too categorically | § 2 (observed vs assumed), § 7.2–7.4 |
| 9 | SHOULD | Signing: designated requirement, not only the cdhash | § 2, § 3.6, § 7.5 |
| 10 | MUST | `CGWindowListCreateImage` obsolete | § 3.4 `shot` |
| 11 | MUST | `AXZoomed`; window ops conflated | § 3.4 window ops, `geometry` |
| 12 | MUST | AX menus and panels assumed | § 3.4 `menuclick`, `panel.*`; § 7.3 |
| 13 | NOTE | SafariDriver vs Web Inspector | § 3 table, page layer |
| 14 | MUST | No target or window selector | § 3.1, § 3.4 `windows` |
| 15 | MUST | No request/result contract | § 3.2 |
| 16 | MUST | Coordinates and key assumptions | § 3.4 coordinates, `chord` |
| 17 | MUST | Weak oracles; evidence classes | § 3.7 |
| 18 | MUST | The spike omits CGEvent delivery | § 7.3 |
| 19 | MUST | 24 h ≠ "grant once" | § 2, § 7.6 |
| 20 | MUST | No staged acceptance; remote-ssh would contradict rule 70 | § 5, § 6 |

Claims in this revision that come from the review and have not been checked on the mini: the
macOS 15 / 15.1 capture-consent changes, the obsolescence of `CGWindowListCreateImage` in the
macOS 15 SDK, and the `kickstart` behaviour with an already-running job. The spike verifies the
last two directly. The first is the subject of § 7.6.
