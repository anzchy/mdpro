# Roster and routing

Who is on the herdr roster, which runtime each runs on, and how work is routed to them. Text moved here from rules 70, 71 and 12 by D355 (ADR-0147 WI-1) keeps the rule's authority (ADR-0147 decision 3);
each block names where it came from. When this file and a rule disagree, the rule wins and this file is the bug.

## Overlay

<!-- moved-from: rule 71 § preamble (ADR-0147) -->
**When the delegator is herdr-delegator, this rule replaces the rule 70 clauses it names below,
and every other rule 70 clause still binds**
([ADR-0124](../../../../docs/adr/0124-two-implementation-slots-and-a-herdr-mixed-model-roster-overlays-rule-70.md)).

Replaced here:
- the roster, the device roles included;
- how Codex agents get work and report;
- their guard;
- who runs audits and the High-tier security review;
- who posts round-one reports: here the delegator posts both auditors' round-one reports, where rule 70
  had the Codex auditor post its own;
- who the two auditors are: `gpt-auditor` and `opus-auditor`, each in a fresh pane by request file, on every PR audit,
  ADR review and plan review ([ADR-0143](../../../../docs/adr/0143-every-audit-runs-gpt-auditor-and-opus-auditor-together-capped-at-two-rounds.md) decision 1).

Added here, for Codex implementors:
- the brief;
- the attacked test matrix;
- the self-acceptance table;
- `$tdd-guardian:tdd-guardian-workflow`, the installed plugin skill that runs the TDD stages.

Unchanged from rule 70:
- the slot cap, which is three everywhere since 2026-10-30 (ADR-0156, superseding ADR-0124's two);
- landing (the three conditions, `--ff-only`, push);
- the landing conditions and the two-verdict merge;
- ADR-0121's tiers; the round cap is **two rounds, the blind audit and one scoped confirm**, after which an open Critical or High goes to the user (ADR-0143 decisions 2 and 3, superseding ADR-0120's cap and folding in ADR-0142; user, 2026-10-25: 「audit now has gpt-auditor + opus-auditor at the same time, audit cap is two」);
- **A review with zero Critical and zero High does not block** (user, 2026-10-25: 「if no c and no h, only medium exists, merge it」): when an implementor's final TDD review or an audit round finds only Medium or Low, the item commits and lands; the Medium and Low findings are recorded in the handoff, the PR and the audit-log row, not sent into another fix round. A Medium `NOT PROVED` does not license landing the AC unmet: only ADR-0146 decision 4's recorded grounds (a), (b) or (c) permit that disposition;
- receipts, number reservation, and the Mac mini and device-batch rules (the device roster is replaced above).

When the delegator is not herdr-delegator, this file does not apply.

## Runtime route

<!-- moved-from: rule 71 § Delegator runtime route (ADR-0147) -->
The **one** herdr agent named `herdr-delegator` may run on Codex/GPT or Claude
(Opus or another Claude model). At the start of a turn, use
`.agents/skills/mdpro-delegator/scripts/delegator-route.sh`; it reads the agent's
Herdr runtime kind. An unknown or missing kind blocks dispatch. The implementor,
auditor and device-agent names, worktrees, briefs and landing gates stay the same.

| Runtime | Completion and coordination | Verifier, registrar, user questions |
|---|---|---|
| Codex/GPT | Keep `prompt.sh`, `watch-agent.sh` and `notify-settled.sh`: a detached wait shows a notification and prompts the idle delegator. Read reports and heartbeat on wake. | Run the deterministic verifier/registrar procedures directly; ask the user through Codex's available question channel. |
| Claude | Keep the original background Bash `herdr agent prompt --wait` / `agent wait` result, plus Claude `SendMessage` where available. The completion scripts return to that Bash call; they do **not** prompt the Claude delegator or add a routine notification. | Use the original `Agent` verifier/registrar and `AskUserQuestion`/`SendMessage` tools. |

On both routes every audit goes to `gpt-auditor` and `opus-auditor` (ADR-0143 decision 1, superseding the 2026-10-24
Codex-route retirement of Opus). When a model is unavailable, the delegator tells the user and the audit waits
(decision 4). A single-auditor round needs the user's word, which the record names.

## Roster

<!-- moved-from: rule 71 § Roster (ADR-0147) -->
| Role | Name | Runs as | Gets work by | Reports by |
|---|---|---|---|---|
| Delegator | `herdr-delegator` | Codex/GPT or Claude, one herdr pane of that name in session `mdpro`, Mac mini main checkout (ADR-0134) | — | — |
| Implementor | `gpt-imple-1`, `gpt-imple-2` | Codex `gpt-6-sol` medium, `-s danger-full-access`, herdr pane, persistent worktree `mdpro-wt/<name>` (ADR-0134) | a brief file plus `herdr agent prompt` | `~/.mdpro-redesign/herdr-spike/<name>/<item>-handoff.md`, then idle |
| Implementor, Low tier (ADR-0133) | `gpt-imple-3` | Codex `gpt-5.6-sol` medium, `-s danger-full-access`, herdr pane, persistent worktree `mdpro-wt/gpt-imple-3`; Low-tier items (ADR-0121) and prep only | a brief file plus `herdr agent prompt` | `~/.mdpro-redesign/herdr-spike/gpt-imple-3/<item>-handoff.md`, then idle |
| Implementor, Claude (2026-10-25) | `opus-imple-1` | Claude Code on Opus (`--model opus --dangerously-skip-permissions`, `MDPRO_ROLE=implementor`, so `role-guard.sh` applies), herdr pane; takes over the worktree of the item it is given (D319: `mdpro-wt/gpt-imple-1`), then D317. User: 「Hand D319 and D317 to Claude implementors, create a new pane powered by Opus, opus-imple-1」, while Codex usage is exhausted | a brief file plus `herdr agent prompt` | `~/.mdpro-redesign/herdr-spike/opus-imple-1/<item>-handoff.md`, then idle |
| Auditor (PRs; ADRs, plans and decision-log entries, [landing-and-audit.md § Audits under herdr](landing-and-audit.md#audits-under-herdr)) | `gpt-auditor` | Codex `gpt-6-sol`, effort medium (user decision, 2026-10-23: 「update gpt-auditor's model to `GPT-6-Sol medium`, from now on」; `gpt-6-astra` high before), herdr pane, detached `mdpro-wt/gpt-auditor` | a new-pane reset ([codex-panes.md § Restart](codex-panes.md#restart)), then `herdr agent prompt` pointing at a request file under `~/.mdpro-redesign/herdr-spike/gpt-auditor/` ([landing-and-audit.md § Requests](landing-and-audit.md#requests)) | `<item>-r<round>.md` in that folder, then idle |
| Auditor (the same reviews, ADR-0143) | `opus-auditor` | Claude Code on Opus (ADR-0137), herdr pane, detached `mdpro-wt/opus-auditor` | a fresh pane, then `herdr agent prompt` pointing at a request file | `<item>-r<round>.md` in `~/.mdpro-redesign/herdr-spike/opus-auditor/`, then idle |
| High-tier security reviewer | `gpt-auditor` and `opus-auditor` | each in its own fresh-pane audit request | the High-tier request names security dimensions, unless policy-only (§ Which set) | security count in each report |
| Landing verifier | herdr-delegator on Codex; `mdpro-landing-verifier` subagent on Claude | the same lane, receipt, ancestry and tree checks | after handoff | verification record under `herdr-spike/delegator/` |
| ADR and plan reviewer | `gpt-auditor` and `opus-auditor` | each in a fresh pane | a review request, only for a plan, an ADR that meets CLAUDE.md § ADR's review trigger, or a gate-sensitive decision-log entry (§ Audits under herdr) | its report |
| Number registrar | herdr-delegator on Codex; `mdpro-number-registrar` subagent on Claude | read-only register check | before brief | reservation record |
| GUI tester for batches formerly assigned to dtrack, Mac mini and Windows | `gpt-auditor` | Codex herdr pane; Windows through `remote-windows-device-test` after the host-key/SSH checks | a fresh-pane device brief from the delegator | `~/.mdpro-redesign/device/<batch>-report.md`, then idle |

The user decisions behind each row are quoted in ADR-0124. The `gpt-imple-3` row and the 2026-10-25 `opus-imple-1`
row record how those roles were first set up.

**Since 2026-10-30, `opus-imple-2` joins as a third implementor** ([ADR-0156](../../../../docs/adr/0156-three-implementation-slots-and-opus-imple-2-joins-the-roster.md);
user: 「create a new pane opus-imple-2 and delegate tasks to it.」, 「Raise cap to 3, all start」): Claude Code on Opus
(`--model opus --dangerously-skip-permissions`, `MDPRO_ROLE=implementor`), persistent worktree `mdpro-wt/opus-imple-2`,
briefed by file plus `herdr agent prompt`, reporting to `~/.mdpro-redesign/herdr-spike/opus-imple-2/<item>-handoff.md`.
Implementors: gpt-imple-1, opus-imple-1, opus-imple-2; gpt-imple-2 stays idle.

**Since 2026-10-31, `gpt-imple-1` is the primary implementor** (user: 「gpt-imple-1 成为主力 implementor」): the
delegator grants each new item to `gpt-imple-1` first, and to `opus-imple-1` or `opus-imple-2` only when gpt-imple-1 already
holds an unlanded item or the user names another implementor. Items already assigned keep their owner, including
#567's tickets on `opus-imple-1` (「让 opus-imple-1 实现 jack-tdd-workflow Skill 相关」). The slot cap is unchanged.

## Subagents

<!-- moved-from: rule 70 § Sessions (ADR-0147) -->
`mdpro-landing-verifier` re-checks a handoff (ancestry, scope, that
`receipt-store.mjs keep-check` finds every receipt and evidence file of the parent kept, the named lanes in a
detached `verify-<sha7>` worktree) before `git merge --ff-only`;
`mdpro-fable-auditor` runs an `opus-auditor` request file when the opus-auditor pane cannot start; and `mdpro-number-registrar` finds the next free ADR number (new items take GitHub issue numbers, not D numbers).
None of them merges, rules on the gate or reserves; the delegator does.
Every one of them runs on Opus (rule 70 § Sessions; ADR-0137 moved the second auditor to the `opus-auditor` pane).

## Effort

<!-- moved-from: rule 71 § Codex agents (ADR-0147) -->
Models: implementors `gpt-6-sol`, and `gpt-6-luna` on `routine` items (ADR-0139; user 「接受 (Recommended)」); gpt-imple-3
`gpt-5.6-sol` on its non-routine items; gpt-auditor `gpt-6-sol` (since 2026-10-23;
`gpt-6-astra` high before). **Effort follows the item's difficulty** ([ADR-0138](../../../../docs/adr/0138-effort-follows-task-difficulty-and-audits-read-from-the-diff-outward.md);
user, 2026-10-23: 「effort 要根据任务难度来route」, accepted 「接受 (Recommended)」). Every brief and request names
`routine`, `standard` or `hard` (the hardest match wins, unlisted is `standard`, ADR-0121 High-by-behaviour is at
least `standard`, a test-only change takes its invariant's difficulty; raise only, never lower; a raise is a new pane):

| Role | routine | standard | hard |
|---|---|---|---|
| Implementor | `gpt-6-luna` high, every implementor ([ADR-0139](../../../../docs/adr/0139-routine-implementor-items-run-on-gpt-6-luna-high-as-a-pilot.md), pilot) | medium | high |
| gpt-auditor, any request | medium | medium | high |
| gpt-auditor confirm or challenge touching a `hard` path, or after a round that found a new High | high | high | high |
| `mdpro-spec-adversary` (every grant) | `mdpro-spec-adversary-std` (`gpt-6-sol` medium) | same | `mdpro-spec-adversary` (`gpt-6-astra` high) |

The pilot (ADR-0138 decision 5) runs to the second High-tier PR's landing; from the next brief on, dispatch reverts to
medium everywhere, the Astra adversary and full-file reading, until the user rules. `~/.codex/config.toml` is never edited for this. The new pane id goes into
the heartbeat assignment.

## Planner

<!-- moved-from: rule 12 § Planning (ADR-0147) -->
- **Who runs it.** The user runs the three skills, which are user-invoked only, in the **`planner`** pane: a Claude Code session with
  `MDPRO_ROLE=planner`, in rule 70's roster. One conversation per feature, because `to-spec` synthesises the grill.
- **What the planner may do.** It publishes the spec and ticket issues to `anzchy/mdpro`. It grants nothing, reserves nothing, commits
  nothing and lands nothing.
- **Where its outputs go.** Glossary edits and the user's approval words, plus an unnumbered ADR draft (CLAUDE.md's ADR structure,
  marked Proposed) **only** for a decision on [CLAUDE.md § ADR](../../../../CLAUDE.md#architecture-decision-records-adr)'s scope list,
  all under `~/.mdpro-redesign/planner/<feature>/`. It hands the paths to the delegator.
- **Which decisions are ADRs** ([ADR-0165](../../../../docs/adr/0165-adrs-record-architecture-and-product-decisions-only.md)
  decisions 1 and 3; [decision log](../../../../docs/agents/decisions/20261102-adr-scope-and-decision-log.md)). The planner proposes the class by CLAUDE.md § ADR's scope list and test, and the delegator classifies before
  reserving a number; doubt goes to the user. The spec cites each ADR it relies on. Every other decision in the spec takes a local id
  `<prefix>-r<N>-D<n>` (e.g. `T567-r1-D1`) and no global number. A feature decision made after `r<N>` is approved goes in
  `docs/specs/<feature>/decisions.md`, under the same ids, committed with the ticket's landing record; one that changes an AC still
  needs `r<N+1>`. A local decision that later governs shared code or another feature is promoted by a new ADR that links the snapshot.

## Guide roster

<!-- moved-from: references/guide.md § 2 (ADR-0147) -->
The reset commands as of 2026-10-27; the current names are [§ Roster](#roster).

| Name | Runs as | Worktree | Reset |
|---|---|---|---|
| gpt-imple-1, gpt-imple-2 | Codex `gpt-6-sol`, `-s danger-full-access`, effort by difficulty (ADR-0138); `gpt-6-luna` high on `routine` items (ADR-0139) | `mdpro-wt/<name>` | `$SK/scripts/reset-codex.sh <name> <wt> <model> <effort> implementor` |
| gpt-imple-3 | Codex `gpt-5.6-sol` (Low tier; `routine` items on Luna) | `mdpro-wt/gpt-imple-3` | same |
| gpt-auditor | Codex `gpt-6-sol`, medium, high on `hard` (ADR-0138); audit sandboxed, device full access | detached `mdpro-wt/gpt-auditor` | `reset-codex.sh gpt-auditor <wt> gpt-6-sol <effort> auditor` for audit; `reset-codex.sh gpt-auditor <wt> <model> <effort> device` for device |
| opus-auditor | required by ADR-0143 on every PR audit | detached `mdpro-wt/opus-auditor` | fresh pane per audit |
| mac-test/dtrack | retired for future GUI assignments; gpt-auditor owns them | — | — |
| High-tier security review | gpt-auditor's fresh-pane audit request and security count | auditor worktree | same reset as audit |
| verifier, number registrar | Codex delegator runs checks; Claude delegator uses the original `Agent` subagents | verify worktrees | — |

Three implementation slots machine-wide (ADR-0156). Never touch picsee's herdr session or
`picsee-dtrack`.

**Context budget** (user, 2026-10-27, 「Delegator: rotate at 250k」). 62 % of the delegator's spend came from calls
above 400k context, and a call above 600k costs about 3.5× one under 200k.
- At about 250k context, write a handoff (mdpro-handoff format) and rotate: `/compact` at a quiet point, or a new
  session.
- Hand long reads (audit reports, logs, diffs) to a subagent that returns a short verdict.
- Prefer one background waiter per dispatch over polling `herdr agent get` or `sleep`.
