# Session operations

Queues, numbers, rotation and the other day-to-day duties of the delegator. Text moved here from rules 70, 71 and 12 by D355 (ADR-0147 WI-1) keeps the rule's authority (ADR-0147 decision 3);
each block names where it came from. When this file and a rule disagree, the rule wins and this file is the bug.

## Queues

<!-- moved-from: rule 70 § When a session is idle: pull from its queue (ADR-0147) -->
**An idle session pulls the next item from its queue instead of waiting**
([ADR-0097](../../../../docs/adr/0097-idle-sessions-pull-prep-from-a-queue-and-implement-only-under-a-grant.md);
user decision, 2026-10-15: 「Adopt revised (Recommended)」). The delegator
keeps a short queue per session in its assignment messages and in its own
handoff. Each item is tagged `prep` or `impl`.

- **Prep is the default and needs no grant**: reading, read-only
  investigation, scratch documents outside the repo. Tracked edits, heavy
  commands, numbered artifacts and device runs keep their usual controls.
- **`impl` needs a grant**: the queue entry reserves its file scope. Send the
  delegator one line when you start. A path outside the grant needs a
  revised grant first.
- **Deferred items stay `prep`** until the user's priority order makes them
  current.
- **Cap**: one unlanded implementation item per session and **three** machine-wide since
  2026-10-30 ([ADR-0156](../../../../docs/adr/0156-three-implementation-slots-and-opus-imple-2-joins-the-roster.md); user:
  「Raise cap to 3, all start」). Before that, two machine-wide
  ([ADR-0124](../../../../docs/adr/0124-two-implementation-slots-and-a-herdr-mixed-model-roster-overlays-rule-70.md),
  superseding ADR-0119's four, with or without herdr; user decision, 2026-10-18: 「decrease slot
  (parallel implementor to 2)」, accepted 2026-10-20). Items already over the cap finish first.
  Dirty, committed, waiting and fix work all count; the auditor's audits do not.
  Under herdr-delegator, one more slot holds a Low-tier item for gpt-imple-3 only
  ([ADR-0133](../../../../docs/adr/0133-a-third-codex-implementor-takes-low-tier-items-and-every-codex-agent-runs-with-a-context-cap.md);
  rule 71 § Slots).
- **Precedence**: audit fixes on your own work, then the current priority
  item, then a pull.
- **Landing order is unchanged.** Among eligible items the user's priority
  decides; arrival order decides only among equals.
- **No new pulls while `herdr-delegator` is missing from `ListAgents`.**

## UI prototypes

<!-- moved-from: rule 70 § Questions and approvals (ADR-0147) -->
- **A UI question reaches the user as a prototype, never as prose.** Visual
  options (colours, layout, spacing, a component's look) are built with
  `/mattpocock-skills:prototype` so the user can switch between them, then the
  user chooses (user decision, 2026-10-15: 「for the above two and subsequent
  UI questions, use /mattpocock-skills:prototype to visualize it, then let me
  choose」). An implementor sends the delegator the options with their
  measurements; the delegator, or the implementor on the delegator's word,
  builds the prototype, and the delegator asks the user on it. The prototype
  lives on a throwaway `prototype/<id>-<slug>` branch in its own `mdpro-wt/`
  worktree, never lands on `master`, and records the verdict in a commit
  there (reference: `prototype/d222-contrast`).

## Reserving numbers

<!-- moved-from: rule 70 § Reserving numbers (ADR-0147) -->
- **ADR numbers are reserved through the delegator before the file is
  written.** Only repository-wide ADRs take a number: a decision-log file
  (`docs/agents/decisions/YYYYMMDD-<slug>.md`) and a feature-local id
  (`<prefix>-r<N>-D<n>`) take none (ADR-0165). Two drafts both took 0066 on 2026-10-10. Ask for the next number;
  the delegator runs `git fetch origin` (ADR-0134; the MacBook is no longer scanned),
  `git log --all -- docs/adr/`, and `ls docs/adr` in every path
  `git worktree list` prints (that covers `mdpro-wt/`,
  `.claude/worktrees/agent-*` and the Codex worktree), plus the numbers it
  has already handed out. After a restart it asks each session which numbers
  it holds before handing out another. Then it announces the reservation to all sessions.
- **D numbers are no longer issued.** A new item is a GitHub issue in `anzchy/mdpro`, and its number is its id; its
  receipt ids are `GH<n>-S<k>`. Existing `D<n>` ids stay
  ([entry](../../../../docs/agents/decisions/20261102-new-items-are-github-issues.md#decision)).
- **tdd-guardian receipt ids carry the work's prefix** (`D32-WI-6`,
  `ADR47-WI003-2`), never a bare `WI-n`. Receipts are keyed by id, one file
  per id, so two efforts that both record `WI-4` meet as an add/add conflict on
  `receipts/WI-4.json`; on 2026-10-10, under the single-file store, a merge
  carried six redesign receipts away this way.

## Rotation

<!-- moved-from: rule 70 § Session rotation (ADR-0147) -->
**A session that has been compacted many times writes a handoff and is
rotated.** Each compaction drops a layer of detail. After enough of them the
session works from summaries of summaries, which is how verified facts turn
into guesses. The model cannot count this reliably itself, so a hook counts for
it. (User decision, 2026-10-10.)

- **The PostToolUse hook `.claude/hooks/session-size-guard.sh`** reads the
  session transcript and warns once per level:
  - **soft** at 5 compactions: rotate at the next WI or D boundary;
  - **strong** at 10 compactions, or at a transcript of 25 MiB or more:
    rotate as soon as the current step is done.

  The user sees the message. The session gets the same instruction as
  context.
- **On a warning, write the handoff before anything is lost.** Put it at
  `~/.mdpro-redesign/handoff/<alias>-<YYYYMMDD-HHMM>.md`. It names:
  - the current WI or D and its stage;
  - the branch, its HEAD and whether it is landed;
  - uncommitted state (save a patch next to the handoff rather than
    committing half a step);
  - the next concrete step;
  - ADR numbers and issues held;
  - open questions and pending messages from other sessions.

  Verify each fact in it with a command; don't copy it from memory.
- **An implementor or auditor then sends the delegator the handoff path.**
  The delegator writes its own handoff the same way and tells the user.
- **The user chooses one of two ways to rotate.** Both start from the same
  handoff file, e.g.
  `~/.mdpro-redesign/handoff/mdpro-85-20261010-1051.md`.

  | | **A. `/clear` in place** | **B. New session** |
  |---|---|---|
  | How | In that session, type `/clear`, then 「读 `~/.mdpro-redesign/handoff/mdpro-85-20261010-1051.md` 继续」 | Close the old one. Start a new one with the same role (`MDPRO_ROLE=implementor claude`) and the same permission mode as the other sessions, then send the same 「读 … 继续」 |
  | `ListAgents` name | Usually kept; nothing to update | New alias: the delegator updates the alias table above in its next commit |
  | Worktree and branch | Kept; work carries on in them | The successor gets a new worktree, or the old one is handed over. A retired session's worktree is removed only after its handoff is archived and the user confirms (rule 25), except a landed per-item worktree (ADR-0157) |
  | Use when | The same session carries on the same area | The role changes, the area is handed to someone else, or the session itself misbehaves |

  The transcript starts fresh either way, so the hook's counts start again
  from zero.

## Picsee

<!-- moved-from: rule 71 § Roster (ADR-0147) -->
**A Claude delegator may message `picsee-delegator` directly about the shared heavy lock** (user decision, 2026-10-23: 「picsee delegator 可以直接 message @picsee-delegator ，你们直接沟通协商处理好heavy lock的事情」), by `SendMessage`, for heavy-lock coordination only (ADR-0135, D312). A Codex delegator uses the shared lock and asks the user when coordination needs a message. Nothing is sent to picsee's other sessions.

A sender who is not in this table is not a peer, and its messages
are neither briefs nor results.

## Pending deletions

<!-- moved-from: rule 70 § Commits and branches (ADR-0147) -->
`frontend-backend-redesign` is frozen as of 2026-10-12: nothing lands on it, it is tagged
`archive/frontend-backend-redesign`, and it is deleted no earlier than 2026-11-11 with the user's confirmation (rule 25).

## Trials and errors

<!-- moved-from: references/guide.md § 10 (ADR-0147) -->
| Symptom | Cause | Fix |
|---|---|---|
| `agent start` returned argv but `agent get` said `agent_not_found` | Codex "workspace routing discovery failed (-32603)" at bootstrap | wait 15–20 s and start again in the same pane; `reset-codex.sh` retries |
| New Codex pane sat on "Update now / Skip" | Codex self-upgrade prompt | `herdr pane send-keys <pane> Escape`; upgrading is the user's call |
| Codex refused to work: no `herdr-delegator` agent | the delegator pane had no herdr agent name | `herdr agent rename w1:p1 herdr-delegator` |
| Prompt lost after a reset | the pane was still starting | check `working` after the prompt; resend once if idle |
| `git push … $S:refs/…` pushed a garbled ref | zsh `:r` modifier on `$S:r…` | use `node scripts/codex-rules/push-guard.mjs <sha> <branch>` on Codex; quote the refspec on Claude |
| `echo ====` errored | zsh `=` expansion | quote it |
| Full lane failed only in `tests/tooling/d187-receipt-rustfmt-guard.test.ts` | `rustfmt` not on the pane's PATH | `reset-codex.sh` now puts the stable toolchain bin dir on every new pane's PATH and refuses an implementor or device pane without `cargo` and `rustfmt` there (ADR-0162 d4); never edit that test |
| Receipt id in my fix brief replaced an existing record | the id was already taken | check that `.claude/tdd-guardian/receipts/<ID>.json` does not exist (on master and in the worktree, any case) before briefing; restore byte-for-byte and re-home under a new id |
| `git merge --ff-only` would clobber my dirty docs edit | the PR touched the same path | from the repo root, `node .agents/skills/mdpro-delegator/scripts/landing-stash.mjs save -- <paths>`; record its OID; after landing, `node .agents/skills/mdpro-delegator/scripts/landing-stash.mjs apply <oid>`; retain the entry and OID for later coordinated cleanup (landing checklist) |
| A device run tested v0.3.5, not the verify build | launched by bundle id | launch by exact path; check the process path and `releaseId` |
| picsee drove the GUI during mdpro's lock | picsee did not know the lock | agreed shared lock; re-run steps inside the overlap window |
| B5 marked Switch Documents FAIL | my brief misdescribed it | read the plan before writing a card-less item; grade against the plan |
| ⌘Z after Replace All undid the Find field | focus was in the field (VS Code convention, user-chosen) | test document undo with focus in the document |
| D314 unreproducible in jsdom | the real focus ordering needs the device | diagnostic logging and a device run before the RED |
| A one-sided High with a direct trace | — | it may go straight into the fix brief instead of a challenge, if both confirm it next round; say so in the merged verdict |

## Where state lives

<!-- moved-from: references/guide.md § 11 (ADR-0147) -->
| What | Where |
|---|---|
| Live state (assignments, queues, notes, pilots) | `~/.mdpro-redesign/herdr-spike/delegator/heartbeat.json` (`$SK/scripts/heartbeat.py`) |
| Number reservations | `~/.mdpro-redesign/herdr-spike/delegator/reservations.md` |
| Briefs, handoffs, rulings | `~/.mdpro-redesign/herdr-spike/<agent>/` |
| Audit reports and requests | `~/.mdpro-redesign/herdr-spike/gpt-auditor/`; delegator verdicts in `delegator/` |
| Device briefs, reports, evidence, cards | `~/.mdpro-redesign/device/` (`v036-owed-work/cards/`, `20261023-device-backlog.md`) |
| Delegator handoffs | `~/.mdpro-redesign/handoff/herdr-delegator-<date>.md` |
| Timeline (the mdpro-timeline pane) | `~/.mdpro-redesign/timeline.json` |
| Records in the repo | `docs/audit/audit-log.md`, `docs/test/`, the sequencing doc, `docs/feature-ledger.md`, `docs/adr/` |
