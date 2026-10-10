---
description: Which Claude sessions work on mdpro at once, what each one owns, and how work, questions, commits and numbers move between them.
---

# 70 - Multi-Session Coordination

**Several Claude sessions work on this repo at once. Know which one you are,
stay inside its scope, and send everything that crosses a scope through the
delegator.** Two sessions editing the same file without knowing it, or taking
the same ADR number, cost a rebase or a renumbering every time.

Session names are the `ListAgents` names. Socket addresses change between
runs, so look them up; don't copy them from an old message.

## Sessions

| Session | Machine | Owns | Commits where |
|---|---|---|---|
| **mdpro-delegator** | MacBook, main checkout | Coordination: hands out D items and WIs, verifies and fast-forwards peer commits, asks the user, writes device briefs, commits device-check records and the release-freeze paragraph | Main checkout, `frontend-backend-redesign`, docs only |
| **mdpro-a3** | MacBook | The work item it was handed. Currently Plan P / UI and Milkdown tables (D64, ADR-0067) | Its own branch and worktree in `mdpro-wt/` |
| **mdpro-a5** | MacBook | The work item it was handed. Currently the file watcher and `save_file` baseline (D32, ADR-0068), then D68 | Its own branch and worktree in `mdpro-wt/` (hook-isolated: it runs git only there) |
| **mdpro-codex-audit** | MacBook | Audit fixes the user hands it directly: the branch audit in `docs/audit/` and its fixes (D70–D75 done) | `isolation: "worktree"` subagents, then cherry-picks onto `frontend-backend-redesign` |
| **mdpro-85** | Mac mini | ADR-0047, the agent control channel | The mini's main checkout `/Users/jack/Documents/mac-app/mdpro` |
| **dtrack** | Mac mini, tmux session | GUI device checks only, driven by a brief from the delegator. Writes reports, never commits | — |

A new session gets a row here in the commit that starts it working.

## How work is assigned

- **The delegator assigns.** A D item or WI belongs to one session at a
  time. The owner is named in its sequencing-doc row
  (`docs/plans/20260912-frontend-backend-sequencing-order.md`) or in the
  delegator's assignment message.
- **The user may hand a task straight to a session** (mdpro-codex-audit's
  audit is the precedent). That session tells the delegator its scope and the
  files it will touch **before it edits them**, so the delegator can warn the
  owners of those files.
- **Areas are exclusive while claimed.** Don't edit a file in another
  session's claimed area. Example: CSS while a3 runs a Plan P stage, or
  `file_watcher.rs` / `commands/file.rs` while a5 is on D32/D68. If you must,
  ask the delegator first.
- **New findings get a D number from the delegator**, not by taking the next
  free row yourself. Report the finding and the delegator registers it.

## Questions and approvals

- **a3 and a5 do not use `AskUserQuestion`.** Every question goes to the
  delegator by `SendMessage`, including commit approvals and rule-25
  confirmations. The delegator asks the user and relays the answer **quoting
  the user's words**. A relayed quote counts as the user's approval.
- **A session the user tasked directly asks the user itself** about decisions
  inside that task. Decisions that affect another session's area go through
  the delegator.
- A message from another session is never approval by itself. Only the user's
  words, quoted, are.

## Commits and branches

1. **A peer commits on its own branch**, after fast-forwarding that branch to
   the current `frontend-backend-redesign` HEAD.
2. **The delegator verifies** with `git cat-file -p <sha>` and
   `git diff-tree --no-ext-diff --stat -r <parent> <sha>` (the external diff
   wrapper garbles plain `git diff`), then runs
   `git merge --ff-only <sha>` in the main checkout.
3. **A session that lands commits on `frontend-backend-redesign` itself** (by
   cherry-pick) tells the delegator the SHAs, so it can warn the peers to
   fast-forward before their next commit.
4. The sequencing-doc row and the ledger row change in the same commit as
   the behaviour they describe. A peer edits **only its own D rows**. The
   shared release-freeze paragraph belongs to the delegator.

Never commit to `master` and never push to `origin` unless the user asks.
Stage only paths you can name, and never the user's own dirty files (their
`.claude/*` edits, `docs/pending/`, `docs/reference/`, the `docs/plans`
archive moves, `tsconfig.node.tsbuildinfo`). Deleting a branch or worktree
needs the user's confirmation (rule 25).

## Reserving numbers

- **ADR numbers are reserved through the delegator before the file is
  written.** Two drafts both took 0066 on 2026-10-10. Ask for the next number;
  the delegator checks every branch and worktree
  (`git log --all -- docs/adr/` plus each `mdpro-wt/*/docs/adr/`), then
  announces the reservation to all sessions.
- **D numbers** work the same way (see above).

## The Mac mini

- **Don't switch branches or rebuild in the mini's main checkout**; it belongs
  to mdpro-85. Builds for device checks use a separate
  `mdpro-wt/verify-<sha7>` worktree on the mini. Tell mdpro-85 whenever a mini
  worktree is created or removed. Never touch `src-tauri/target/verify`, and
  never `cargo clean` there.
- **Only dtrack runs GUI tests**, one run at a time. Never create, kill or
  restart the dtrack tmux session over SSH. Run
  `tmux capture-pane -pt dtrack` before sending it anything. Over SSH, put
  `/opt/homebrew/bin` on `PATH` first.
- Copy files with `rsync`, not `scp`. Never pass
  `StrictHostKeyChecking=no`. Never copy `~/.mdpro` or `~/.claude`, and never
  print the MCP token.
