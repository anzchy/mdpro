# User questions and answers

Every question any mdpro session puts to the user, with the user's answer quoted
verbatim. Answers given in a session's chat get buried under its peer messages;
this file is where they are kept. The rule that governs it is in `CLAUDE.md`
§ "User questions and answers" (user decision, 2026-10-14:
「目前我在本session和各个session直接问的问题的回答会被很多消息淹没掉，之后你单独维护一个md文档」).

- **Newest entry first.** Entries are append-only: a later answer that changes an
  earlier one is a new entry that names the one it replaces. An old entry is
  never edited.
- **One entry per question.** Several questions asked in one prompt each get
  their own entry.
- **Quote the answer exactly** (the option label, plus any note the user typed).
- **Say where it was acted on**: the ADR, sequencing-doc row, rule or commit
  that carries the decision, or "—" when it was a one-off permission.

## Entries

| Date (CST) | Asked by | Item | Question | Answer (verbatim) | Recorded in |
|---|---|---|---|---|---|
| 2026-10-14 ~12:15 | mdpro-delegator | worktrees | Remove 14 landed, clean worktrees and their local branches (`git worktree remove` + `git branch -d`, no force) for adr95-pr-ci-gate, build-windows-signing, d185, d188, d190-wi2/wi4/wi5, d191-ledger-windows-table, d191-followup, d192, d193, d194, d196, d198? Remote branches stay 30 days. | 「Remove all 14 (Recommended)」 | Done the same turn; one-off rule-25 approval |
| 2026-10-14 ~12:15 | mdpro-delegator | D190 W2 | Install the 0742ee3 build on win-desktop and run the D190 WI-2 save check (W2); it restarts mdpro several times. Is anything unsaved in mdpro on win-desktop right now? | 「Nothing unsaved, go ahead」 | Brief `docs/pending/20261014-brief-windows-d190-w2.md`; covers that batch only |
| 2026-10-14 ~10:49 | mdpro-delegator | D190 W1–W5 | The Windows device batch will close mdpro on win-desktop, install the new build over 0.3.1 in `D:\programs\mdpro`, and restart it several times with test documents. Is anything unsaved in mdpro on win-desktop right now? | 「Nothing unsaved, go ahead」 | [W1–W5 record](../test/20261014-d190-w1-w5-windows-device-check.md); covered that batch only |
| 2026-10-14 ~09:54 | mdpro-delegator | ADR-0095 | After a peer rebases a handed-off branch, the PR head must be updated, which needs a force-push that rule 25 confirms every time. What should the standing rule be? | 「Standing force-with-lease (Recommended)」 | Rule 25 § Standing Exception; rule 70 item 2; [ADR-0095](../adr/0095-pull-request-ci-is-a-landing-gate.md) |
| 2026-10-14 ~09:54 | mdpro-delegator | ADR-0095 | PR CI becomes a landing gate. Should GitHub branch protection on master also require that check, with "require branches to be up to date"? | 「Yes, enforce on GitHub (Recommended)」 | Branch protection on master requires `ci-gate` (strict); [ADR-0095](../adr/0095-pull-request-ci-is-a-landing-gate.md) |
| 2026-10-14 ~09:46 | mdpro-delegator | D194 | In WYSIWYG, how should a definition like `[r]: http://x "T"` appear? | 「Visible muted block (Recommended)」 | [ADR-0094](../adr/0094-link-reference-definitions-are-kept-as-visible-blocks-and-references-are-inlined.md); D194 row |
| 2026-10-14 ~09:46 | mdpro-delegator | D194 | After any edit in WYSIWYG, mdpro deletes reference-link definitions and rewrites `[docs][r]` as `[docs](http://x)`. How should the fix work? | 「B: keep definitions (Recommended)」 | ADR-0094; D194 row (option A deferred as D197) |

## Standing decisions still in force

Answers from before this file existed. They are quoted from the delegator's handoffs and the
records named; the date is when the user gave them.

| Date | Decision (verbatim) | Recorded in |
|---|---|---|
| 2026-10-14 | 「完成v0.3.2 版本的release就暂停所有的开发」 | Delegator handoff 20261014-0857 |
| 2026-10-14 | 「不进，按现有里程碑发布」 (v0.3.2 scope; D190 WI-6/WI-7 and D189 deferred) | D190 row |
| 2026-10-14 | 「Windows上测试用 /remote-windows-device-test 来完成，安装包也打包好ssh 传过去」 | Delegator handoff 20261014-0857 |
| 2026-10-14 | 「原地覆盖 0.3.1」 (Windows installs go over 0.3.1 in place) | Windows briefs |
| 2026-10-12 | 「只有分支branch 经过Codex audit 并且修复，没有critical / high severity findings之后，才允许ff 到master」 | Rule 70 item 4; ADR-0085 |
| 2026-10-12 | 「落地即推」 | Rule 70 |
| 2026-10-12 | 「remote上的分支branch 满30天再删」 | Rule 70; ADR-0084 |
| 2026-10-11 | 「mark 这个就是最后所有的 UI 设计都参考的设计方案」 | CLAUDE.md § Design System |
| 2026-10-11 | 「同意，作为常设安排」 (one worktree per implementor item, created without asking) | CLAUDE.md § Worktrees |
