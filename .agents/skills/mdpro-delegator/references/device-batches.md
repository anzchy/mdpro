# Device batches

How the delegator batches device checks, routes them to a tester and runs the Windows host lock. Text moved here from rules 70, 71 and 12 by D355 (ADR-0147 WI-1) keeps the rule's authority (ADR-0147 decision 3);
each block names where it came from. When this file and a rule disagree, the rule wins and this file is the bug.

## Batches

<!-- moved-from: rule 70 § Device-check batches (ADR-0147) -->
**The delegator sends device checks in batches by area, not by count.** A
fixed count mixes unrelated areas into one brief and holds a ready BLOCK
back until the count fills. (User decision, 2026-10-10.)

- **A batch is one area**: editor and tables, the file watcher, MCP,
  update and release. Every item in it is checked on one build, so the
  tester stays in one setup and each result is context for the next.
- **Send a batch when its area is done**, i.e. no item in that area is
  expected to land within the next handoff. A ready 0.3.1 gate item waits
  for at most one more landing in its area, never longer.
- **Size: 6–10 items, or about 45 minutes of tester time.** Ten is a ceiling,
  not a trigger. The 2026-10-10 run took 9 items and 20 minutes and still
  had one operator slip. Split a larger set by area.
- **The gate's combined runs stay whole.** The watcher regression
  (D32 / D68 / D69 / D86) and the release-candidate regression on the locked
  SHA run as written in the sequencing doc's `#release-031-gate`, never
  split into routine batches.
- **Every item in a brief states its failure condition and the code path it
  must reach**, with the log line that proves the path was reached. A probe
  that passes without reaching its path is recorded as not exercised, not
  as passed (the D86 ⌘S×20 probe on `eb061fa`).
- **Items that need no device check**: tooling-only changes (verified
  where they run) and changes with no user-visible effect (say so in the
  row). An item that needs a special setup (an old client, a second
  machine) gets its own brief.
- The delegator keeps the pending list per area in its handoff, and the
  item's row keeps `真机未验` until a committed record says otherwise.

## Device routing

<!-- moved-from: rule 71 § Roster (ADR-0147) -->
**All macOS device tests go to `gpt-auditor`** (user decision, 2026-10-25: 「from now on, all mac os device test goes to gpt-auditor, redelegate and pause opus device test task」). The delegator resets `gpt-auditor` into a fresh pane, gives it the device brief through herdr, and reads its report under `~/.mdpro-redesign/device/`. The tester role, desktop lock, launch-by-path and device rules apply. This supersedes the 2026-10-25 interim routing of GUI batches to `opus-auditor`, and `gpt-imple-3`'s macOS device checks; opus-auditor runs no device test. **A device pane runs with `-s danger-full-access`** (user decision, 2026-10-25: 「Full access for device panes (Recommended)」), a narrow exception to ADR-0134 decision 4: the sandboxed gpt-auditor could not create the desktop GUI lock under `~/.cache` or restore `~/.mdpro/config.json`. A pane reset for an audit, confirm, challenge or review request stays sandboxed.

## Win-desktop lock

<!-- moved-from: rule 71 § Roster (ADR-0147) -->
**`win-desktop` has one operator at a time** (user decision, 2026-11-01: 「加 win-desktop 锁，写进 rule 71」, after asking
「gpt-imple-1 和opus-auditor 最好是不是不要一起操作Windows desktop」). Two agents on the host at once can restart mdpro twice on
one clearance, interleave real SendInput with another run's reads, and race on the same `mdpro-audit` folder, latch, scheduled
tasks and manifests.
- **Every command on `win-desktop` runs under the win-desktop lock**, held for the whole brief, from the first SSH to the
  readback: SSH itself, `deploy.sh`, `push.sh`, `mdpro.sh`, `ui.sh`, `cdp.sh`, `log.sh`, and any probe, read-only ones included.
- **It is not the Mac's `desktop-gui.lock`.** That lock guards the Mac mini's own desktop and is shared with picsee. A Windows run
  does not take it, and a macOS GUI batch does not take this one.
- **Who may hold it:** only the agent a delegator brief or request names for that Windows work, normally `gpt-auditor` in device
  mode. An implementor never holds it: it writes the probe and asks the delegator for the run. An auditor holds it only under a
  request that names the Windows steps it may run.
- **Until the lock script lands, the delegator is the lock.** It records `heartbeat.py set win-desktop holder=<agent>
  brief=<file> start=<ISO>` before the prompt, sends no second Windows brief or request while one is held, and clears the entry
  (`holder=none`) once it has read the report. After the script lands, every Windows brief and request names its acquire and
  release, and the skill's Mac scripts refuse to reach the host without a held lock.
- **A stale holder** (idle, no report) is released by the delegator only after it has read the holder's pane and checked on the
  host that no `mdpro-audit-*` task and no driver process of that run remains.

## Mac mini delegator steps

<!-- moved-from: rule 70 § The Mac mini (ADR-0147) -->
- **Since ADR-0134 the mini's main checkout belongs to herdr-delegator**; development runs on the mini, and the
  device tester is `mac-test` (tmux `dtrack`), briefed directly by `SendMessage` (rule 71). The bullets below still
  bind where they apply; those about SSH, `rsync` and the MacBook hook receiver now matter only for remote hosts.
- **When the tester is stuck on a Computer Use permission prompt for mdpro,
  pick "Allow for this session" yourself; don't wait for the user.** The
  tester's `/clear` before every brief drops the earlier grant, so every run
  starts at this prompt; the hook's `permission_prompt` notification (about
  6 s after the prompt appears) is the signal to look. Check with `capture-pane` that `mdpro` is the only
  app listed, then `tmux send-keys -t dtrack Down` and `Enter`, and
  `capture-pane` again to confirm the run went on. If the prompt names any
  other app, or offers anything other than a session-scoped grant, leave it
  and ask the user. (User decision, 2026-10-10.)
