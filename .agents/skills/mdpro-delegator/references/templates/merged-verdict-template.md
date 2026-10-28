# <ID> round <k>, merged verdict (herdr-delegator, <date>)

Range `<base>..<sha>` (PR #<n>). Tier <T>, difficulty <D>.
both auditors on every audit, at most two rounds (ADR-0143).
- Protocol: master `<M>`, dimensions blob `<B>`; both auditors echoed the same pinned blob.
- Codex (<model effort>): C<n> H<n> M<n> L<n> · BLOCKING C<n> H<n> (security C<n> H<n>).
- Security section in gpt-auditor's report (High tier): C<n> H<n> M<n> L<n>.
- Opus report: C<n> H<n> M<n> L<n>.

COVERAGE: <compare both auditors' per-dimension entries and L site lists; explain any skipped dimension>.

AC verdicts:
- AC-<n>: <gpt-auditor PROVED|NOT PROVED|WRONG with evidence>; <opus-auditor PROVED|NOT PROVED|WRONG with evidence>.
  <Cite any ADR-0146 decision 4 acceptance and its (a), (b) or (c) ground.>

Mediums listed one line each:
- M<n> (<gpt-auditor|opus-auditor>): <dimension, site, issue, and disposition>. Lows are counted only.

Merged Highs:
- **<A> (gpt-auditor).** <one line and evidence>. Stands until a scoped confirm closes it.
- **<B> (opus-auditor).** <one line and evidence>. Stands until a scoped confirm closes it.

Verdict: C<n> H<n> · BLOCKING C<n> H<n>. <Next: fix <n> to <owner>; round <k+1> scoped confirm by both auditors | the audit gate
is open.>
