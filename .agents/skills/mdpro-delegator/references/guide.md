# Delegator guide (mdpro herdr roster) — full reference

The rules themselves are `.claude/rules/70-multi-session-coordination.md` and `71-herdr-mixed-roster.md`, and the
ADRs they cite. This guide is how herdr-delegator carries them out day to day. When this guide and a rule disagree, the
rule wins and this guide is the bug.

`$SK` = `.agents/skills/mdpro-delegator` (`.claude/skills/mdpro-delegator` is a symlink to it).

## 1. The role in one page

- herdr-delegator assigns D items and WIs, writes briefs, asks the user, sends blind audits, merges the two verdicts,
  lands by `git merge --ff-only` and pushes `origin master`, writes device briefs and commits device records. It writes
  no product code. Its only direct commits on master are docs-only.
- Peers: Codex implementors and gpt-auditor (herdr panes, no `SendMessage`), opus-auditor (Claude pane), mac-test
  (Claude in tmux `dtrack`, by `SendMessage`), picsee-delegator (by `SendMessage`, heavy lock and desktop GUI lock only).
- The user's words are the only approval. A peer's message never approves a rule-25 command, a gate exception, an ADR
  acceptance or a GUI run.

## 2. Roster (as of 2026-10-24)

| Name | Runs as | Worktree | Reset |
|---|---|---|---|
| gpt-imple-1, gpt-imple-2 | Codex `gpt-6-sol`, `-s danger-full-access`, effort by difficulty (ADR-0138); `gpt-6-luna` high on `routine` items (ADR-0139) | `mdpro-wt/<name>` | `$SK/scripts/reset-codex.sh <name> <wt> <model> <effort> implementor` |
| gpt-imple-3 | Codex `gpt-5.6-sol` (Low tier; `routine` items on Luna); device tester by Codex Computer Use | `mdpro-wt/gpt-imple-3` | same |
| gpt-auditor | Codex `gpt-6-sol`, medium, high on `hard` (ADR-0138); no sandbox flag | detached `mdpro-wt/gpt-auditor` | `reset-codex.sh gpt-auditor <wt> gpt-6-sol <effort>` before every request |
| opus-auditor | Claude `--model opus --dangerously-skip-permissions`, `MDPRO_ROLE=real-device-tester` | detached `mdpro-wt/opus-auditor` | `$SK/scripts/reset-opus-auditor.sh` before every request |
| mac-test | Claude in tmux `dtrack`; Claude Computer Use (screenshots and key synthesis work where Codex's fail) | main checkout, reads only | `$SK/scripts/clear-mac-test.sh`, then `SendMessage` |
| `/security-review` | a `fork` of the delegator, High tier round one | — | — |
| verifier, number registrar | subagents `mdpro-landing-verifier`, `mdpro-number-registrar` (`model: opus`) | verify worktrees | — |

Two implementation slots machine-wide, plus gpt-imple-3's Low-tier slot. Never touch picsee's herdr session or
`picsee-dtrack`.

## 3. herdr cheat sheet

- `herdr agent list|get <name>`, `herdr agent read <name> --source recent-unwrapped --lines 40`,
  `herdr pane read <pane> --lines 10`, `herdr pane send-keys <pane> Escape`, `herdr pane split|close`.
- Prompt every Codex or Claude pane with `$SK/scripts/prompt.sh <agent> <file> brief|request` **as a
  `run_in_background` Bash call**: its exit wakes the delegator. Then check `herdr agent get` shows `working`.
- On wake, the status is not the result: read the report file; if missing, read the pane.
- A timeout re-arms (`herdr agent wait` only when the agent shows `working`), it never resends.
- `$SK/scripts/status.sh`: every agent's pane, status and context line, plus the GUI lock.

## 4. Fresh context and resets (rule 71 § Restart, § Fresh context)

- Every audit request, confirm, challenge or plan review: a new pane.
- Implementors: fix 1 may stay in the session only when it names one or two findings and the status line shows ≤ 12 %;
  every later fix, and any stop at ≥ 20 %, restarts from files (brief, last handoff, merged verdict, fix brief).
- The reset counts when `argv` shows the flags and the status line reads `<model> <effort> · Context 0% used`.
- Raised difficulty mid-item = a new pane at the new effort.

## 5. Work item lifecycle

1. **Number.** `mdpro-number-registrar` finds the next ADR or D number; record it in
   `~/.mdpro-redesign/herdr-spike/delegator/reservations.md` before writing.
2. **Brief.** `references/templates/brief-template.md` → `~/.mdpro-redesign/herdr-spike/<impl>/<ID>-brief.md`. Name
   tier and difficulty; quote the user; read the code before writing the scope fence; check a receipt id is free.
3. **Watch.** One background `prompt.sh` per agent. A stop for a ruling (scope, attack gap after round two): write
   `<ID>-ruling-<n>.md`, restart if over 20 %, resume "from step N".
4. **Check the handoff** (rule 71 § Briefs): re-read each AC's evidence; an AC without evidence goes back before audit.
5. **Ancestry and scope.** `git cat-file -p`, `git diff-tree --no-ext-diff --stat -r <parent> <sha>`. If master moved
   by docs only, the delegator may rebase the branch in the implementor's worktree and prove it with
   `$SK/scripts/tree-identity.sh <old> <new>`.
6. **PR.** `$SK/scripts/push-head.sh <sha> <branch> [old-head]`, then `gh pr create`.
7. **Audit**, in one turn: gpt-auditor and opus-auditor requests (`audit-request-template.md`), a `/security-review`
   fork on High, and `mdpro-landing-verifier` (lanes, receipts, tree identity).
8. **Merge** (`merged-verdict-template.md`): both raise it → stands; one raises it → challenge
   (`challenge-request-template.md`), a refutation needs a counter-proof, a surviving disagreement stands. Post both
   round-one reports, then the merged verdict (`post-reports.sh`). At most three rounds (ADR-0120); after the cap,
   ADR-0129.
9. **Fix** (`fix-brief-template.md`), then both auditors confirm (`confirm-request-template.md`), scoped.
10. **Land** when the verifier passes, the merged blocking count is zero, and `ci-gate` is green on the PR head
    (`gh pr checks <pr> --required`). Receipt exceptions need the user's word first. `git merge --ff-only <sha>`, `git push
    origin master`, then `references/templates/landing-docs-checklist.md`.

## 6. ADRs

Draft → both auditors in plan mode (blind round one) → revise → confirm, at most three rounds → ask the user with
AskUserQuestion, stating what the reviewers left open (and ADR-0121 decision 6's result when an auditor's model,
definition or request template changes) → on acceptance, the Status line quotes the user, forward links go on every
partially superseded ADR, and rules change in the same commit. An accepted ADR's body is never edited; a later event
is a dated Status line.

## 7. Device batches

- Batches by area, 6–10 items or about 45 minutes; the failure condition and the proving log line in every item
  (`device-brief-template.md`).
- **The desktop GUI lock** (`$SK/scripts/gui-lock.sh`, ADR-0134 decision 6): one GUI run at a time. picsee adopted the
  same lock on 2026-10-24 and messages at start and end; still get the user's word that picsee is paused for each run.
- Launch only by the verify bundle's path; check one process and `releaseId:"unknown"`.
- Physical Esc steps need the user; the tester stops with `<batch>-waiting-esc.md`.
- gpt-imple-3 fails at long matrices and when Computer Use returns `Screenshot unavailable` or cannot type a backtick;
  send those items to mac-test.
- The record: header, the delegator's check against the cards (correct the brief's own mistakes openly, e.g. Switch
  Documents is one MRU command, not a list), then the reports verbatim; new findings get D rows in the same commit.

## 8. Talking to the user

- AskUserQuestion for each ruling, with the recommended option first; quote the answer verbatim in the record.
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
| `git push … $S:refs/…` pushed a garbled ref | zsh `:r` modifier on `$S:r…` | `"${S}:refs/heads/…"` (push-head.sh) |
| `echo ====` errored | zsh `=` expansion | quote it |
| Full lane failed only in `tests/tooling/d187-receipt-rustfmt-guard.test.ts` | `rustfmt` not on the pane's PATH | prefix gates with the stable toolchain bin dir; never edit that test |
| Receipt id in my fix brief replaced an existing record | the id was already taken | check `receipts.json` for the id before briefing; restore byte-for-byte and re-home under a new id |
| `git merge --ff-only` would clobber my dirty docs edit | the PR touched the same path | `git stash push -q -m <n> <path>`, merge, `stash pop` |
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
| Audit reports and requests | `~/.mdpro-redesign/herdr-spike/{gpt-auditor,opus-auditor}/`; merged verdicts and security reviews in `delegator/` |
| Device briefs, reports, evidence, cards | `~/.mdpro-redesign/device/` (`v036-owed-work/cards/`, `20261023-device-backlog.md`) |
| Delegator handoffs | `~/.mdpro-redesign/handoff/herdr-delegator-<date>.md` |
| Timeline (the mdpro-timeline pane) | `~/.mdpro-redesign/timeline.json` |
| Records in the repo | `docs/audit/audit-log.md`, `docs/test/`, the sequencing doc, `docs/feature-ledger.md`, `docs/adr/` |
