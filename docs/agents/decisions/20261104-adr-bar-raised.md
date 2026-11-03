# 2026-11-04: The ADR bar is raised

- **Decided:** 2026-11-04, by the user: 「按照减负路径，把1-5开始做，由你用subagent做，同时如果有adr相关rule，要update成最新的规则，不轻易建adr，参考Codex auditor最佳实践。」,
  after 「我看xiaolai的vmark只有10+ 个adr，我需要减负。」. The content is drawn from gpt-auditor's portfolio audit,
  [`docs/audit/20261104-adr-portfolio-audit.md`](../../audit/20261104-adr-portfolio-audit.md) (F4, F5, F7, F8, and the
  migration plan's step 4), for issue #629.
- **Decision:** A repository-wide ADR needs both parts of a two-part test: the decision is on ADR-0165's scope list,
  and it is significant (hard or costly to reverse once shipped, or binding more than one module or an external
  party); a decision that fails the second part, or whose classification is in doubt, is recorded below the bar and
  becomes an ADR only when it is disputed, superseded or built on. A correction that changes no decision takes no
  number; an amendment takes a new ADR only when its topic's contract changes, and a real contract change on a topic
  that already has amendments replaces the topic with one ADR; an ADR is one page of about 1,000 words at most, with
  "Enforced by" as a pointer. The delegator writes the answer to both parts in each number reservation, and there is
  no bulk Status sweep, archive directory, body rewrite, backfill or target count.
- **Why:** The audit finds the portfolio's cost is which decisions become global records, not their length: VMark's
  median record is only 1.17× shorter than mdpro's, but it keeps 19 global records against 163. Nygard, Azure and AWS
  all scope an ADR to an *architecturally significant* decision, and ADR-0165's scope list alone admits small ones
  such as a colour value (ADR-0110). Thirty records amend a topic lead, and two (0008, 0018) only correct a
  measurement (F5); several records are runbooks or review transcripts (F4). Sending doubt to the ADR route made the
  heavy path the default.
- **Costs:** "Significant" is a judgment, and two classifiers can differ. A decision that lands below the bar lives in
  an issue, a spec or the ledger, which is less durable than `docs/adr/`; an issue is not in an offline clone, the
  reason ADR-0165 option 2(c) lost. Flipping doubt can under-record a decision that later matters; the promotion rule
  is the only remedy, and it acts late. A record under 1,000 words can leave out evidence that a reader then has to
  follow a link to find.
- **Why not a new ADR:** ADR-0165 decision 1 makes a change to the boundary between ADRs and this log take a new ADR.
  This entry leaves that boundary where it is: product decisions are still ADRs or below the bar, process decisions
  are still log entries, and nothing moves into or out of the log. It raises the threshold between an ADR and the
  below-the-bar record that decision 1 already names. Classified as a log entry by herdr-delegator, 2026-11-04.
- **changes:** `docs/adr/README.md` (§ The bar, new; § Writing and changing an ADR, new, which takes the Location,
  Structure, Status, immutability and Review bullets with the Location, Structure and "Enforced by" text changed; the
  Mixed cases bullet), `CLAUDE.md` § Architecture Decision Records (ADR), the Status of
  [ADR-0165](../../adr/0165-adrs-record-architecture-and-product-decisions-only.md) (a dated "Current text" line),
  the delegator skill's classification and reservation lines (`.agents/skills/mdpro-delegator/references/guide.md`,
  `references/roster-and-routing.md`, `references/session-ops.md` § Reserving numbers), and this log's § Entries.
- **supersedes:** ADR-0165 decision 1's "Who classifies" sentence "Doubt goes to the global route and to the user"
  (the README's copy: "Doubt goes to the ADR route and to the user"), and decision 1's "Below the bar" clause, which
  now takes every product decision that fails the significance test, not only one "too small for an ADR". The
  README's "Keep it to a page where you can" (the 2026-10-11 rules amendment, not an ADR) becomes a limit. Unchanged:
  ADR-0165 decision 1's scope list and test, decision 4's review trigger list and its "doubt means review", the
  immutability of accepted bodies, and the decision log for process.
- **gate-sensitive:** no: it changes none of § Gate-sensitive entries' triggers (no landing or CI condition, auditor
  set or round cap, receipt contract, release publication or verification control, or user-data control), and the
  ADR review trigger list is unchanged (classified by herdr-delegator, 2026-11-04).
