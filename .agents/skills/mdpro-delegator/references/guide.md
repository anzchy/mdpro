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

## 2. Roster

The roster table is in [roster-and-routing.md](roster-and-routing.md#roster), with this guide's 2026-10-24 table under
[Guide roster](roster-and-routing.md#guide-roster).

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

## 4. Fresh context and resets (codex-panes.md § Restart, landing-and-audit.md § Requests)

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
4. **Check the handoff** (landing-and-audit.md § Confirm handoff): re-read each AC's evidence; an AC without evidence goes back before audit.
5. **Ancestry and scope.** `git cat-file -p`, `git diff-tree --no-ext-diff --stat -r <parent> <sha>`. If master moved
   by docs only, the delegator may rebase the branch in the implementor's worktree and prove it with
   `$SK/scripts/tree-identity.sh <old> <new>`.
6. **PR.** On Codex, `node scripts/codex-rules/push-guard.mjs <sha> <branch> [--expected-remote-oid <A>]`;
   on Claude, use rule 70's plain push. Then `gh pr create`.
7. **Audit**: both auditors on every audit, at most two rounds (ADR-0143). Send fresh-pane requests
   (`audit-request-template.md`), including a security section on High unless policy-only (§ Which set; [policy set](../../../../docs/agents/decisions/20261102-cc-suite-policy-set.md));
   run the landing verifier directly on Codex or through the original `mdpro-landing-verifier` subagent on Claude.
8. **Verdict** (`merged-verdict-template.md`): check both reports' evidence and record the merged blocking count.
   Post the reports when a PR exists. At most two rounds (ADR-0143); after the cap, ADR-0129.
9. **Fix** (`fix-brief-template.md`), then both auditors confirm (`confirm-request-template.md`), scoped.
10. **Land** when the verifier passes, the merged blocking count is zero, and `ci-gate` is green on the PR head
    (`gh pr checks <pr> --required`). The checked scripts do not check verifier PASS or audit verdict.
    For verifiers dispatched after the policy commit is on master, receipt verdicts do not require an exception;
    the Codex verifier reports `check-pending` as information and requires `receipt-store.mjs keep-check` for PASS
    ([decision](../../../../docs/agents/decisions/20261104-receipts-are-audit-evidence.md)).
    GH592, GH607 and D354 wait for this policy commit on master and receive fresh verification before landing.
    On Codex, use `node scripts/codex-rules/land-guard.mjs <sha>`;
    for direct docs commits, `node scripts/codex-rules/land-guard.mjs --docs-only`, except `docs/agents/audit-dimensions.md` and `docs/agents/audit-policy-set.md` (ADR-0146 decision 1: High-tier PR under the old pin and both-auditor plan review); a gate-sensitive decision-log entry ([README § Gate-sensitive entries](../../../../docs/agents/decisions/README.md#gate-sensitive-entries)) goes this way only after both auditors' plan review of it and its rule edit. On Claude, use
    `git merge --ff-only <sha>` and `git push origin master`, then `references/templates/landing-docs-checklist.md`.

## 6. ADRs and decision-log entries

**Classify first** ([ADR-0165](../../../../docs/adr/0165-adrs-record-architecture-and-product-decisions-only.md);
[decision log](../../../../docs/agents/decisions/20261102-adr-scope-and-decision-log.md)), before
reserving any number. Use the two-part test, scope and significance, in [the bar](../../../../docs/adr/README.md#the-bar).
A product or architecture decision, or a mixed one, is a repository-wide ADR. A process or tooling decision is a
[decision-log entry](../../../../docs/agents/decisions/README.md). A decision inside one feature is a spec-local decision
(rule 12). Doubt goes below the bar.

**An ADR.** Reserve its number. Then check CLAUDE.md § ADR's review trigger and record the classification in its Status
line; doubt means review.
- *Review needed:* draft → both auditors in plan mode → revise → confirm, at most two rounds → ask the user through the
  active runtime's question channel, stating what the reviewers left open (and ADR-0121 decision 6's result when an
  auditor's model, definition or request template changes).
- *No review needed:* draft → ask the user.
- *On acceptance:* the Status line quotes the user, forward links go on every partially superseded ADR, and rules
  change in the same commit. An accepted ADR's body is never edited; a later event is a dated Status line.

**A decision-log entry** takes no number. Write the entry and its rule edit in one commit, by the README's format.
- *Gate-sensitive* ([README § Gate-sensitive entries](../../../../docs/agents/decisions/README.md#gate-sensitive-entries); doubt means review): both auditors plan-review the entry with
  [plan-review-request-template.md](templates/plan-review-request-template.md) before it lands.
- *Otherwise:* a docs-only commit quoting the user. An entry whose change is a script rides that script's PR.

**Until the references lint lands** (ADR-0165 follow-up 2), check by hand at each docs commit that every cited ADR
number, feature-local id and decision-log file resolves, and that every decision-log file is in the index.

## 7. Device batches

- Reset the macOS tester with `reset-codex.sh gpt-auditor <wt> <model> <effort> device`, then send its brief from `~/.mdpro-redesign/device/` with `prompt.sh gpt-auditor <file> brief`. Audit requests use an `auditor` reset and `request` dispatch.
- Batches by area, 6–10 items or about 45 minutes; the failure condition and the proving log line in every item
  (`device-brief-template.md`).
- **The desktop GUI lock** (`$SK/scripts/gui-lock.sh`, ADR-0134 decision 6): one GUI run at a time. picsee adopted the
  same lock on 2026-10-24 and messages at start and end; the 2026-10-27 agreement removes the per-run picsee word.
  `acquire` and `wait` print `acquisition_id=<uuid>`; keep that ID and call
  `gui-lock.sh release <batch> --acquisition-id <uuid>` after cleanup, aborted runs included.
- Launch only by the verify bundle's path; check one process and `releaseId:"unknown"`.
- Physical Esc steps need the user; the tester stops with `<batch>-waiting-esc.md`.
- gpt-auditor owns all macOS device batches under rule 71; send each batch from a new device-mode pane.
- The record: header, the delegator's check against the cards (correct the brief's own mistakes openly, e.g. Switch
  Documents is one MRU command, not a list), then the reports verbatim; new findings get issues opened in the same step.

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

## 10. Trials and errors

The table is in [session-ops.md](session-ops.md#trials-and-errors).

## 11. Where state lives

The table is in [session-ops.md](session-ops.md#where-state-lives).
