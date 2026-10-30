# 0157. A landed branch's worktree is removed at landing, without a separate confirmation

**Status**: Accepted (2026-10-30, by the user: 「Accept (Recommended)」). Proposed earlier that day as r2, with the round-two Mediums folded in. picsee-delegator relayed the user's words
「已经提交并成功merge pr的对应的worktree要及时清除，这个要作为一个rule，现在查看一下worktree情况，也同步给mdpro delegator」.
The user then answered herdr-delegator's question about worktree cleanup in that session: they chose 「Standing rule for mdpro」 and asked 「选择2，符合最佳实践吗」. Drafted by herdr-delegator. r2 answers
the r1 plan review by gpt-auditor and opus-auditor (both C0 H2). Both r2 confirms were C0 H0 (gpt M2 L1, opus M3 L4), and those Mediums and Lows are folded in below without a third round.

**Supersedes, for worktrees only:**
- rule 70 § Commits and branches, "Deleting a branch or worktree needs the user's confirmation (rule 25)";
- `CLAUDE.md` § Worktrees, "Removal still goes through the delegator under rule 25, once the item has landed", which
  covers implementor worktrees;
- rule 70 § Session rotation, "A retired session's worktree is removed only after its handoff is archived and the user
  confirms (rule 25)", for a per-item worktree whose item has landed. A retired agent's pane home stays exempt
  (decision 5).

The clauses about branches stay as they are. This ADR leaves alone:
- the verifier's own cleanup of its `verify-<sha7>` worktree (rule 70);
- ADR-0084 decision 3, together with `CLAUDE.md` § Worktrees' "`git worktree remove <dir>` then `git branch -d
  <branch>`". Once the landing is confirmed, the local branch is still deleted only with the confirmation that rule 70
  requires.

## Context

`CLAUDE.md` § Worktrees already says that a merged worktree is removed once its landing is confirmed. Rule 70, though,
makes every removal wait for the user's confirmation. In practice removals waited, and worktrees piled up. On
2026-10-30, `mdpro-wt/` held 94 GB across 41 worktrees. The Mac mini's data volume filled up (118 MB free). Three mdpro
agents and picsee's builds stopped on `ENOSPC` partway through their items. The same day, the user gave picsee this
rule, and picsee removed 51 merged worktrees.

Forces at the time:

- **A landed checkout holds nothing git does not.** Once its commits are on `master` and its branch is kept, git keeps
  everything the checkout tracked.
- **Clean to git is not the same as disposable.** `git worktree remove` without `--force` refuses a tree that has
  modified or untracked files. It still deletes **ignored** files, though. A probe during review confirmed this: an
  ignored `handmade.cache` was gone after a plain removal that exited 0.
- **Neither ancestry nor a name proves a checkout is idle.** A worktree can be switched to another branch that has
  already landed. A `verify-*` build can still be in use by a device batch after its verifier has reported.
- **A leftover worktree misleads.** Its stale tdd-guardian state gets mistaken for live work (`CLAUDE.md` §
  Worktrees).
- **Some worktrees are not per item:**
  - pane homes (ADR-0134), including those of retired agents;
  - `prototype/*` (rule 70);
  - hand-made probe trees (`-base`, `-revert`).

## Options considered

**A. Keep today's rule: every removal asks the user.** Lost: removals waited, the disk filled, and the user asked
for a standing rule.

**B. Remove at landing without asking, behind identity, liveness and ignored-file checks; never `--force` over
anything not on a fixed list; branches kept** (chosen).

**C. Remove at landing with `--force` every time, after archiving artifacts, as picsee does.** Lost: `--force`
discards deliberate edits. On 2026-10-30 there were four such probe trees. A forced removal cannot be undone.

## Decision

1. **Scope.** Right after a landing is pushed, the delegator may remove one worktree without asking: **the landed
   item's worktree**. Its entry in `git worktree list --porcelain` must name exactly the landed item's branch, with
   HEAD equal to the landed SHA. The delegator may also remove a `verify-<sha7>` worktree in two cases:
   - the verifier finished and did not remove its own worktree;
   - the verify build was made for this item's device check, and that check's report is written.

   In either case the worktree must be detached at a SHA that `origin/master` contains, after `git fetch`.

   A worktree that a check kept at its landing, including one left over from before this record, may be removed at any
   later landing or sweep. All of decisions 1 to 5 must hold for it then.
2. **Liveness.** It is removed only when all of these hold:
   - `$HOME/.cache/desktop-gui.lock` is free. Its owner record has no path field, so any holder blocks the removal,
     picsee included;
   - no heartbeat assignment, open device brief or running agent names that path;
   - `lsof +D <path>` lists no process.

   If any of them fails, the worktree is kept until the next landing.
3. **Ignored and untracked files.** The delegator first runs `git -C <path> status --porcelain --ignored`. Two kinds of
   path are disposable:
   - **build outputs:** `node_modules/`, `dist/`, `src-tauri/target/`, `src-tauri/gen/`, `coverage/`, `.vite/`, `.stryker-tmp/`, and the copied
     sidecar `src-tauri/binaries/mdpro_mcp-aarch64-apple-darwin`;
   - **tooling and session state:**
     - every untracked or ignored file under `.claude/tdd-guardian/`, `evidence/` included;
     - `.codex/rules/mdpro-role.rules` and `.codex/rules/.started-at`;
     - `.claude/mind.mv2*`, `.tokenize/` and `.gstack/`.

     State is always archived first, by decision 4, whether git reports it as untracked or as ignored.

   With anything else present, whether modified, untracked or ignored, the worktree is kept and reported to the user.
4. **`--force` exception.** It may be used only when the only blockers are tooling and session state from decision 3.
   Modifications to tracked files under `.claude/tdd-guardian/` (`receipts.json` and the older run reports) count as
   state too. The
   steps are:
   1. copy them to a new directory, `~/.mdpro-redesign/archive/worktrees/<dir>-<UTC yyyymmddThhmmss>/`, failing if it
      already exists;
   2. check the copy with `diff -r`, which must exit 0;
   3. immediately before removal, re-run both the status check and `diff -r`;
   4. remove only if the status output matches the first one byte for byte, and `diff -r` still exits 0. Decision 2's
      `lsof` check has already shown that no process holds the tree.
5. **Never removed by this rule:**
   - pane-home worktrees (`mdpro-wt/<agent-name>`, ADR-0134), retired agents' included;
   - `prototype/*`;
   - any worktree whose branch or HEAD holds a commit that `origin/master` does not contain;
   - a detached worktree whose HEAD reflog holds such a commit. This test is for detached worktrees only: a branch
     worktree's pre-rebase tips survive in the kept branch's own reflog;
   - any worktree that a delegator other than mdpro's created.
6. **Branches are kept.** A local branch is deleted only with rule 70's confirmation, as ADR-0084 decision 3 already
   requires. Remote branches follow ADR-0084.
7. **Sweep.** Each delegator handoff lists every worktree that has merged but was kept, and every worktree whose branch
   or HEAD is not an ancestor of `origin/master` (detached reflog-only blockers included), with the reason each was kept. Nothing on that list is removed without the
   user's word.
8. **Unchanged:** every other rule-25 pattern (`rm -rf`, force pushes, branch `-D`, `git clean`), and rule 70's notice
   to mdpro-device-harness when a Mac mini worktree is created or removed. That role has been offline since
   2026-10-18, so no notice is sent while it is gone.

## Consequences

- Landed checkouts no longer fill the disk, and their stale state stops looking like live work.
- **Given up:**
  - The user no longer sees each removal before it happens.
  - An ignored file on the decision 3 list is deleted with the worktree, even if a person made it by hand under one
    of those names.
- **Some trees are always kept.** A Claude Code session leaves `.claude/settings.json` modified, and any tracked edit
  keeps its tree. So a tree that a Claude session worked in is normally kept and reported, unless that edit is gone.
- **More worktrees are kept than under option C.** Those kept under decisions 2, 3 and 5 still need a person to look
  at them. The sweep reports them, but the disk can fill again if nobody acts on it.
- The checks add a few commands to every landing, and `lsof +D` is slow on a large tree.
- On acceptance, `CLAUDE.md` § Worktrees and rule 70 § Commits and branches each get a line pointing here.
