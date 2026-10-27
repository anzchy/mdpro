# Delegator guide (mdpro herdr roster) — full reference

The rules themselves are `.claude/rules/70-multi-session-coordination.md` and `71-herdr-mixed-roster.md`, and the
ADRs they cite. This guide is how herdr-delegator carries them out day to day. When this guide and a rule disagree, the
rule wins and this guide is the bug.

`$SK` = `.agents/skills/mdpro-delegator` (`.claude/skills/mdpro-delegator` is a symlink to it).

## 1. The role in one page

- herdr-delegator assigns D items and WIs, writes briefs, asks the user, sends gpt-auditor audit requests and records its verdict,
  lands by `git merge --ff-only` and pushes `origin master`, writes device briefs and commits device records. It writes
  no product code. Its only direct commits on master are docs-only.
- Peers: Codex implementors and gpt-auditor (herdr panes, no `SendMessage`); a Claude delegator can
  `SendMessage` picsee-delegator for heavy lock and desktop GUI lock coordination. gpt-auditor owns future GUI work formerly assigned
  to dtrack/mac-test (user decision 2026-10-24).
- The user's words are the only approval. A peer's message never approves a rule-25 command, a gate exception, an ADR
  acceptance or a GUI run.

## 2. Roster (as of 2026-10-24)

| Name | Runs as | Worktree | Reset |
|---|---|---|---|
| gpt-imple-1, gpt-imple-2 | Codex `gpt-6-sol`, `-s danger-full-access`, effort by difficulty (ADR-0138); `gpt-6-luna` high on `routine` items (ADR-0139) | `mdpro-wt/<name>` | `$SK/scripts/reset-codex.sh <name> <wt> <model> <effort> implementor` |
| gpt-imple-3 | Codex `gpt-5.6-sol` (Low tier; `routine` items on Luna); device tester by Codex Computer Use | `mdpro-wt/gpt-imple-3` | same |
| gpt-auditor | Codex `gpt-6-sol`, medium, high on `hard` (ADR-0138); no sandbox flag | detached `mdpro-wt/gpt-auditor` | `reset-codex.sh gpt-auditor <wt> gpt-6-sol <effort> auditor` before every request |
| opus-auditor | required by ADR-0143 on every audit | detached `mdpro-wt/opus-auditor` | fresh pane per audit |
| mac-test/dtrack | retired for future GUI assignments; gpt-auditor owns them | — | — |
| High-tier security review | gpt-auditor's fresh-pane audit request and security count | auditor worktree | same reset as audit |
| verifier, number registrar | Codex delegator runs checks; Claude delegator uses the original `Agent` subagents | verify worktrees | — |

Two implementation slots machine-wide, plus gpt-imple-3's Low-tier slot. Never touch picsee's herdr session or
`picsee-dtrack`.

**Context budget** (user, 2026-10-27, 「Delegator: rotate at 250k」). 62 % of the delegator's spend came from calls
above 400k context, and a call above 600k costs about 3.5× one under 200k.
- At about 250k context, write a handoff (mdpro-handoff format) and rotate: `/compact` at a quiet point, or a new
  session.
- Hand long reads (audit reports, logs, diffs) to a subagent that returns a short verdict.
- Prefer one background waiter per dispatch over polling `herdr agent get` or `sleep`.

## 3. herdr cheat sheet

- Run `$SK/scripts/delegator-route.sh` before dispatch. `codex` and `claude` are the only accepted results; unknown
  identity blocks dispatch. The script reads Herdr's active `herdr-delegator` runtime, so a handover changes the route
  without renaming implementors or auditors.

- `herdr agent list|get <name>`, `herdr agent read <name> --source recent-unwrapped --lines 40`,
  `herdr pane read <pane> --lines 10`, `herdr pane send-keys <pane> Escape`, `herdr pane split|close`.
- Prompt every agent with `$SK/scripts/prompt.sh <agent> <file> brief|request 7200000 <expected-report>`
  in a background process; it binds `--session mdpro` and waits for settlement. On Codex it shows
  a Herdr notification and prompts the idle delegator, because a yielded `exec_command` does not
  start a later turn. On Claude the Bash completion itself resumes the delegator, with no extra
  prompt or routine notification. Check `herdr --session mdpro agent get` shows `working` after dispatch.
- For an agent already `working` after a delegator restart, use one detached
  `$SK/scripts/watch-agent.sh <agent> <expected-report>` instead of sending another prompt.
- On wake, the status is not the result: read the report file; if missing, read the pane.
- Provision a Codex worktree only through `reset-codex.sh`; between-window hand provisioning ends with WI-2 landing.
- A timeout re-arms only after `herdr --session mdpro agent get` still shows `working`; it never resends.
- `$SK/scripts/status.sh`: every agent's pane, status and context line, plus the GUI lock.

## 4. Fresh context and resets (rule 71 § Restart, § Fresh context)

- Every audit request, confirm, challenge or plan review: a new pane.
- Implementors: fix 1 may stay in the session only when it names one or two findings and the status line shows ≤ 12 %;
  every later fix, and any stop at ≥ 20 %, restarts from files (brief, last handoff, merged verdict, fix brief).
- The reset counts when `argv` shows the flags and the status line reads `<model> <effort> · Context 0% used`.
- Raised difficulty mid-item = a new pane at the new effort.

## 5. Work item lifecycle

1. **Number.** Claude uses `mdpro-number-registrar`; Codex runs its register scan directly. Record the result in
   `~/.mdpro-redesign/herdr-spike/delegator/reservations.md` before writing.
2. **Brief.** `references/templates/brief-template.md` → `~/.mdpro-redesign/herdr-spike/<impl>/<ID>-brief.md`. Name
   tier and difficulty; quote the user; read the code before writing the scope fence; check a receipt id is free.
3. **Watch.** One background `prompt.sh` per agent. A stop for a ruling (scope, attack gap after round two): write
   `<ID>-ruling-<n>.md`, restart if over 20 %, resume "from step N".
4. **Check the handoff** (rule 71 § Briefs): re-read each AC's evidence; an AC without evidence goes back before audit.
5. **Ancestry and scope.** `git cat-file -p`, `git diff-tree --no-ext-diff --stat -r <parent> <sha>`. If master moved
   by docs only, the delegator may rebase the branch in the implementor's worktree and prove it with
   `$SK/scripts/tree-identity.sh <old> <new>`.
6. **PR.** On Codex, `node scripts/codex-rules/push-guard.mjs <sha> <branch> [--expected-remote-oid <A>]`;
   on Claude, use rule 70's plain push. Then `gh pr create`.
7. **Audit**: both auditors on every audit, at most two rounds (ADR-0143). Send fresh-pane requests
   (`audit-request-template.md`), including a security section on High;
   run the landing verifier directly on Codex or through the original `mdpro-landing-verifier` subagent on Claude.
8. **Verdict** (`merged-verdict-template.md`): check both reports' evidence and record the merged blocking count.
   Post the reports when a PR exists. At most two rounds (ADR-0143); after the cap, ADR-0129.
9. **Fix** (`fix-brief-template.md`), then gpt-auditor confirms (`confirm-request-template.md`), scoped.
10. **Land** when the verifier passes, the merged blocking count is zero, and `ci-gate` is green on the PR head
    (`gh pr checks <pr> --required`). The checked scripts do not check verifier PASS or audit verdict.
    Receipt exceptions need the user's word first. On Codex, use `node scripts/codex-rules/land-guard.mjs <sha>`;
    for direct docs commits, `node scripts/codex-rules/land-guard.mjs --docs-only`. On Claude, use
    `git merge --ff-only <sha>` and `git push origin master`, then `references/templates/landing-docs-checklist.md`.

## 6. ADRs

Draft → gpt-auditor in plan mode → revise → confirm, at most three rounds → ask the user through
the active runtime's question channel, stating what the reviewers left open (and ADR-0121 decision 6's result when an auditor's model,
definition or request template changes) → on acceptance, the Status line quotes the user, forward links go on every
partially superseded ADR, and rules change in the same commit. An accepted ADR's body is never edited; a later event
is a dated Status line.

## 7. Device batches

- Batches by area, 6–10 items or about 45 minutes; the failure condition and the proving log line in every item
  (`device-brief-template.md`).
- **The desktop GUI lock** (`$SK/scripts/gui-lock.sh`, ADR-0134 decision 6): one GUI run at a time. picsee adopted the
  same lock on 2026-10-24 and messages at start and end; the 2026-10-27 agreement removes the per-run picsee word.
  `acquire` and `wait` print `acquisition_id=<uuid>`; keep that ID and call
  `gui-lock.sh release <batch> --acquisition-id <uuid>` after cleanup, aborted runs included.
- Launch only by the verify bundle's path; check one process and `releaseId:"unknown"`.
- Physical Esc steps need the user; the tester stops with `<batch>-waiting-esc.md`.
- gpt-imple-3 fails at long matrices and when Computer Use returns `Screenshot unavailable` or cannot type a backtick;
  send those items to gpt-auditor under a new device brief.
- The record: header, the delegator's check against the cards (correct the brief's own mistakes openly, e.g. Switch
  Documents is one MRU command, not a list), then the reports verbatim; new findings get D rows in the same commit.

## 8. Talking to the user

- Claude uses `AskUserQuestion` for rulings; Codex uses its available question channel. Put the recommended
  option first and quote the answer verbatim in the record.
- Questions the user asks go to `docs/reference/user-question-and-answer.md` when the answer is worth finding later
  (not status questions); batch those commits while a code handoff is in flight.
- Tell the user what needs their hands: physical Esc, picsee pause, Windows key setup, Codex upgrade.

## 9. Hard rules

Never: write product code; edit `~/.codex/config.toml` or `~/.codex/memories/`; upgrade the shared Codex install;
stage the user's dirty files (`.claude/settings.json`, `.claude/mind.mv2*`, `.tokenize/`, the `scripts/**/.claude/`
dirs); print the MCP or hook token; pass `StrictHostKeyChecking=no`; `scp` (use `rsync`); start/stop the herdr server;
touch picsee's session; run a heavy command outside `scripts/heavy-lock.sh`; a rule-25 command without the user's word;
force-push anything but a PR branch with `--force-with-lease`.

## 10. Trials and errors (2026-10-23/24)

| Symptom | Cause | Fix |
|---|---|---|
| `agent start` returned argv but `agent get` said `agent_not_found` | Codex "workspace routing discovery failed (-32603)" at bootstrap | wait 15–20 s and start again in the same pane; `reset-codex.sh` retries |
| New Codex pane sat on "Update now / Skip" | Codex self-upgrade prompt | `herdr pane send-keys <pane> Escape`; upgrading is the user's call |
| Codex refused to work: no `herdr-delegator` agent | the delegator pane had no herdr agent name | `herdr agent rename w1:p1 herdr-delegator` |
| Prompt lost after a reset | the pane was still starting | check `working` after the prompt; resend once if idle |
| `git push … $S:refs/…` pushed a garbled ref | zsh `:r` modifier on `$S:r…` | use `node scripts/codex-rules/push-guard.mjs <sha> <branch>` on Codex; quote the refspec on Claude |
| `echo ====` errored | zsh `=` expansion | quote it |
| Full lane failed only in `tests/tooling/d187-receipt-rustfmt-guard.test.ts` | `rustfmt` not on the pane's PATH | prefix gates with the stable toolchain bin dir; never edit that test |
| Receipt id in my fix brief replaced an existing record | the id was already taken | check `receipts.json` for the id before briefing; restore byte-for-byte and re-home under a new id |
| `git merge --ff-only` would clobber my dirty docs edit | the PR touched the same path | from the repo root, `node .agents/skills/mdpro-delegator/scripts/landing-stash.mjs save -- <paths>`; record its OID; after landing, `node .agents/skills/mdpro-delegator/scripts/landing-stash.mjs apply <oid>`; retain the entry and OID for later coordinated cleanup (landing checklist) |
| A device run tested v0.3.5, not the verify build | launched by bundle id | launch by exact path; check the process path and `releaseId` |
| picsee drove the GUI during mdpro's lock | picsee did not know the lock | agreed shared lock; re-run steps inside the overlap window |
| B5 marked Switch Documents FAIL | my brief misdescribed it | read the plan before writing a card-less item; grade against the plan |
| ⌘Z after Replace All undid the Find field | focus was in the field (VS Code convention, user-chosen) | test document undo with focus in the document |
| D314 unreproducible in jsdom | the real focus ordering needs the device | diagnostic logging and a device run before the RED |
| A one-sided High with a direct trace | — | it may go straight into the fix brief instead of a challenge, if both confirm it next round; say so in the merged verdict |

## 11. Where state lives

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
