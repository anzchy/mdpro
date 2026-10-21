# Merging with an open High: what practice says (2026-10-21)

Research record behind [ADR-0129](../adr/0129-a-high-that-survives-the-audit-cap-is-classified-tracked-and-expires.md).
An Opus subagent ran it for herdr-delegator on the user's question:
「三轮之后还有high没关，用subagent 搜索一下Claude、codex等相关最佳实践是怎样的，high默认存在，然后safe to merge吗」.
Claims marked **[primary]** come from the vendor's or standard's own page. The others are noted
where they come from.

## Answer

**No: an open High does not merge by default.** Neither the tools nor mdpro's rules allow it.
Practice allows a merge with a known High only after a recorded human decision, and only in three
cases:

1. **Refuted.** The finding is a false positive. A human closes it with a written reason.
2. **Pre-existing.** The High is tracked separately and has an owner.
3. **Accepted risk.** The High is real and the PR introduced it. Someone signs, the reason is
   written down, a compensating control is named where one exists, and a deadline is set.

## Findings

1. **[primary] Claude Code Review does not approve or block a PR itself.** "A review never approves
   or blocks the pull request, so the decision to merge stays with your team", and its check run
   "never concludes as a failure". A team that wants a gate scripts one on the Important count. Its
   severities are Important, Nit and Pre-existing.
   <https://code.claude.com/docs/en/code-review>, <https://code.claude.com/docs/en/code-review-pull-requests>
2. **[primary] Anthropic's internal practice blocks on open findings.** "A PR can't merge while any
   finding from the bug review or the security review is still open. You either fix it or close
   the thread with a short reason." And: "After three rounds, the reviewer asks the author to step
   back and reconsider the approach." Also: "an agent's approval never counts as a person's."
   <https://claude.dev/blog/solving-code-review-at-anthropic/>
3. **[primary] Codex on GitHub flags only P0 and P1 findings.** Its review rules "don't replace
   tests, branch protections, or required approvals." <https://learn.chatgpt.com/docs/third-party/github>
4. **[primary] `claude-code-security-review` only comments.** It filters out the finding classes
   most prone to false positives. It is not hardened against prompt injection.
   <https://github.com/anthropics/claude-code-security-review>
5. **[primary] GitHub code scanning can block a merge at a configurable severity**, for example
   "High or higher". Dismissing an alert can be routed to approvers.
   <https://docs.github.com/en/code-security/code-scanning/managing-your-code-scanning-configuration/set-code-scanning-merge-protection>,
   <https://docs.github.com/en/code-security/concepts/security-at-scale/delegated-alert-dismissal>
6. **[primary] Google's code-review standard.** No change that worsens code health is justified
   "except in an emergency". A dispute is escalated and its outcome recorded, and a change is not
   left waiting. <https://google.github.io/eng-practices/review/reviewer/standard.html>
7. **[primary, task text only] NIST SSDF RV.2.1/RV.2.2.** "Analyze each vulnerability… to plan its
   remediation or other risk response", and "Plan and implement risk responses". The NIST PDF
   could not be fetched. <https://cybersecurity.cd.foundation/docs/phase-2/ssdf/ssdf-rv/>
8. **[search snippet only] GitLab** sets a fix deadline (SLA) for each High. An exception request
   must name the impact and the barrier to fixing it.
   <https://handbook.gitlab.com/handbook/security/product-security/vulnerability-management/sla-exceptions>

## Not covered

- No OWASP primary source on risk acceptance was found.
- The Microsoft SDL bug-bar sample has no waiver rule.
- CISA BOD 19-02 could not be fetched.
- Copilot and CodeRabbit were not researched.
