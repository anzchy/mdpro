# 0084. A branch on `origin` is kept thirty days after its work lands, not deleted when the work is done

**Status**: Accepted (2026-10-12). User's words: 「remote上的分支branch 满30天再删，而不是直接开发完就删」. Decided by the user, recorded by mdpro-delegator. Partially supersedes [ADR-0083](0083-master-is-the-single-integration-trunk.md): the one-week deletion of `frontend-backend-redesign` in Decision 4 and the "deleted once the next minor ships" clause for `release/x.y` in Decision 3. Every other clause of ADR-0083 stands.

## Context

ADR-0083 made `master` the single trunk and said the frozen `frontend-backend-redesign` would be tagged and deleted after one week, and that a `release/x.y` branch would be deleted once the next minor shipped. Both are branches on `origin`. The user, seeing the 2026-10-19 deletion in the timeline the same day, set a longer retention: a remote branch lives thirty days after its work has landed before it is deleted.

Forces at the time:

- A deleted remote branch is recoverable only from a tag or a reflog nobody else has. Device-check records, audits and ADRs cite SHAs; a tag keeps them reachable, but a branch name is what a person types when they go back to look.
- The cost of keeping a branch on `origin` is one line in `git branch -r`. The cost of deleting one early is a question with no quick answer a month later.
- Local worktrees and local branches are a different matter: a landed worktree left lying around gets its stale tdd-guardian state mistaken for live work (`CLAUDE.md` § Worktrees), so local cleanup after landing stays as it was.

## Options considered

**A. Delete when the work is done** (ADR-0083's one week for the old trunk, "next minor" for release branches). Lost: it is what the user turned down.

**B. Keep thirty days after the work landed, then delete with rule-25 confirmation** (chosen). The clock starts when the branch's last commit is on `master` (or, for `release/x.y`, when its last tag is published), not when the branch was created.

**C. Never delete remote branches.** Not asked for; the list grows without bound and the stale-state problem moves to the remote.

## Decision

1. **A branch on `origin` is deleted no earlier than thirty days after its work landed.** For `frontend-backend-redesign` that is 2026-11-11 (its last commit `c8f5f72` reached `master` on 2026-10-12). For a `release/x.y` branch it is thirty days after its last `v*` tag was published, and never before the next minor ships. For any other branch that was pushed to `origin`, thirty days after its landing commit.
2. **Deletion still needs the user's confirmation** (rule 25), with the exact command, and the branch is tagged first where ADR-0083 says so.
3. **Local cleanup is unchanged.** A landed worktree is removed and its local branch deleted once the landing is confirmed, as `CLAUDE.md` § Worktrees and rule 70 say.
4. **`role-guard.sh` keeps the old trunk name protected until the remote branch is gone.** The removal of `frontend-backend-redesign` from `PROTECTED`, and of its fixtures from the hook test, moves from 2026-10-19 to the deletion date.

## Consequences

- `git branch -r` carries the frozen trunk for a month, and anyone reading it must know from rule 70 that nothing lands there.
- The hook protects a name nobody uses for a month; the cost is two lines.
- Every date in the migration texts that said "one week" or "2026-10-19" is corrected in the commit that accepts this record. ADR-0083's body is not edited; its Status line gets the forward link.
