# Implementor

What an implementor session (rule 70's `mdpro-implementor-*`; under herdr, `gpt-imple-*` and `opus-imple-*`) does
between its brief and its handoff. The brief names the item, its scope and its acceptance criteria; this file is the
standing part. Text moved here by D355 (ADR-0147 WI-1) keeps its rule's authority (ADR-0147 decision 3).

<!-- read-every-session:begin -->
- [.claude/rules/10-tdd.md](../../.claude/rules/10-tdd.md)
<!-- read-every-session:end -->

## Scope and questions

You work only inside the brief's worktree, branch and paths; a path outside them needs a revised grant. You never use
`AskUserQuestion`, push, or commit on `master` (rule 70 § Questions and approvals; `role-guard.sh` refuses them for
Claude, `.codex/rules/*` for Codex). A question, a rule-25 confirmation or a scope stop goes to the delegator, and you stop.
A UI question goes to the delegator with each option's measurements, for a prototype
([session-ops.md](../../.agents/skills/mdpro-delegator/references/session-ops.md#ui-prototypes)).

## Matrix and attack

A test matrix is attacked before any RED is recorded (user decision, 2026-10-20: 「加上，gpt-imple-1, gpt-imple-2都适用」).
On both runtimes, follow [jack-tdd-workflow](../../.agents/skills/jack-tdd-workflow/SKILL.md#1-design-the-test-matrix) with a fresh attacker
(`ATTACK-NOT-RUN` and stop if it cannot run), then settle one RED per cycle (ADR-0161). The brief and the delegator's
rulings win over the skill where they differ.

## Receipts

<!-- moved-from: rule 71 § Codex agents (ADR-0147) -->
- **Receipts are recorded, as for any implementor (rule 10).** Frontend REDs use
  the repository entry script, unlocked with at most 2 workers:

  ```
  node scripts/tdd/red-receipt.mjs record --id <ID> --test tests/<file>.test.ts
  node scripts/tdd/red-receipt.mjs verify --id <ID>
  ```

  Rust REDs use the same entry with `--lane rust` (`record`, then `verify`), after `cargo fmt`
  (ADR-0145 d1, d8). The rust lane's own command runs under `scripts/heavy-lock.sh`. The full frontend coverage lane
  also keeps the heavy lock. The entry runs the receipt engine vendored at `scripts/tdd/vendor/tdd-guardian-0.10.2/`,
  never the Claude or Codex plugin cache (#566); an engine upgrade is a reviewed diff of that directory.
  **Record the red before the production change it tests.** A receipt that carries
  `implementation-already-present` is named in the handoff (M3a, 2026-10-20).

## Rebase and tree identity

<!-- moved-from: rule 70 § Commits and branches (ADR-0147) -->
1. **A peer commits on its own branch**, after bringing it up to the current
   `master` HEAD: fast-forward if it has no unlanded
   commits, otherwise `git rebase master`. Its gates pass
   before handoff (rule 60 and rule 10's lanes are the author's job),
   and the handoff names the SHA and the lanes that passed. If `--ff-only`
   refuses because HEAD moved, the peer rebases, re-runs its gates and
   resends. **Re-runs are by tree identity**: if `git rev-parse <sha>:src`,
   `:tests` and `:src-tauri` equal the trees the lanes already ran on, the
   handoff says so and names that commit, and only the decisive test files,
   typecheck, build and `ledger:check` run again. When two handoffs share a
   parent, the delegator lands the one that arrived first and tells the
   other to hold, then rebase once; the held peer starts no lane run until
   told (user decision, 2026-10-11: one full run per commit, machine-wide).

## Fix sessions

<!-- moved-from: rule 71 § Fresh context (ADR-0147) -->
- **Implementor fixes** are numbered by the ADR-0143 round they answer. Fix 1, which answers the
  blind audit, stays in the item's session only when both of these hold:
  - the fix brief names one or two findings, each with its regression test;
  - the Codex status line shows at most 12 % used (half the 250k cap on the 1M window; ADR-0133
    decision 5).

  Every other fix (fix 2, and any post-cap fix under ADR-0129) gets a new session, seeded only with
  the brief, the last handoff, the merged verdict and the fix brief.
- **At any stop or handoff, a session showing 20 % or more used, or one that has compacted,**
  writes a progress note and restarts by [§ Restart](../../.agents/skills/mdpro-delegator/references/codex-panes.md#restart) from the brief and that note (ADR-0133
  decision 5). A session counts as compacted when its pane shows Codex's compaction notice, or when
  its used percentage has fallen since the previous wake. The delegator reads the status line with
  `herdr agent read <name> --source recent-unwrapped` at each wake.
- **Every handoff names the approaches it rejected, and why.** A fix session knows only what the
  files say.

## Self-acceptance

<!-- moved-from: rule 71 § Briefs and self-acceptance (ADR-0147) -->
An implementor does not hand off with an AC unproved unless it names that AC, says why, and says
what it needs. An AC that conflicts with another is recorded, resolved toward the plan and the
brief's background, and the work goes on. The implementor stops only for a path outside scope.

The handoff ends with the brief's `AC | evidence | verdict` table
([landing-and-audit.md](../../.agents/skills/mdpro-delegator/references/landing-and-audit.md#briefs) has its six sections). On a failed Windows run you do not
iterate by yourself: your next round starts from the delegator's ruling
([landing-and-audit.md](../../.agents/skills/mdpro-delegator/references/landing-and-audit.md#failed-windows-run)).

## Gated items

A rule-12 (gated) item follows rule 12 and its spec snapshot; its cycles are `jack-tdd-workflow`'s on both runtimes. The snapshot wins over
the ticket, the brief and the card ([landing-and-audit.md](../../.agents/skills/mdpro-delegator/references/landing-and-audit.md#gated-items)).

## Commit splitting

<!-- moved-from: CLAUDE.md § Git Commit Conventions (ADR-0147) -->
### Splitting Strategy for mdpro

When making large changes, split by architectural layer:

1. **Backend first**: `src-tauri/src/commands/*.rs` - Rust commands
2. **Services**: `src/services/*.ts` - TypeScript IPC wrappers
3. **Stores**: `src/stores/*.ts` - Zustand state
4. **Hooks**: `src/hooks/*.ts` - React hooks
5. **Components**: `src/components/**/*.tsx` - UI components
6. **Styles**: `src/styles/*.css` - CSS updates
7. **Integration**: `src/App.tsx` - Wiring everything together
8. **Docs/Tests**: Documentation and test fixtures

## Worktrees

<!-- moved-from: CLAUDE.md § Worktrees (ADR-0147) -->
- **Implementor sessions (rule 70) get one worktree per item in flight**, created
  without asking each time (user decision, 2026-10-11: 「同意，作为常设安排」).
  A held item's rebase must not wait for the active item's worktree. Removal
  still goes through the delegator under rule 25, once the item has landed.
