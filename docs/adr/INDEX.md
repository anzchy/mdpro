# ADR index

Where each of the 163 numbered ADRs stands, by topic. It is navigation, not a ruling: an entry here changes no record's
authority, and the record's own Status line wins any disagreement. Built from gpt-auditor's portfolio audit at
`8706fae6` ([`docs/audit/20261104-adr-portfolio-audit.md`](../audit/20261104-adr-portfolio-audit.md)), which gives the
reason for every row. How ADRs are written and when one is warranted: [README](README.md).

**How to read it.**
- **Topics** list each product or architecture decision once, under its topic lead. An indented record extends or amends
  the lead above it and still binds until a later ADR replaces the topic.
- **Process records** are ADRs from before ADR-0165.
  The current rule lives in the home named; a clause that is not yet folded is still governed by the ADR.
- **History** records are superseded, rejected or spent. They stay in the tree, unchanged, for their reasoning.
- Labels: *Proposed* (never accepted), *release history* (decided for one release), *known defect* (an accepted product
  defect, open until its record says otherwise), *partial* (only part of it still applies).
- 0092, 0123 and 0126 were never used.

## Topics

### Editor and rendering

- [0009](0009-narrow-source-table-detection-to-gfm.md) Source-mode table detection follows GFM, not a looser local rule.
  - [0008](0008-non-candidate-delimiter-class-measured-against-gfm.md) Measurement correction: the non-candidate delimiter class against GFM; the decision is unchanged.
- [0012](0012-lezer-parser-for-toc-headings.md) The TOC parses headings with Lezer; remark is refused.
- [0013](0013-under-detection-shifts-table-ordinals.md) *Known defect:* under-detection shifts table ordinals on write; identity by ordinal stays the direction.
- [0014](0014-toc-addresses-headings-by-document-order.md) The TOC addresses headings by document order.
- [0015](0015-toc-staleness-is-closed-by-cancellation-not-a-revision-number.md) TOC staleness is closed by cancellation, not a revision number.
- [0016](0016-large-document-guard-predicate-is-a-source-structure-score.md) The large-document guard is a source-structure score that keeps a document out of WYSIWYG.
  - [0019](0019-large-document-guard-adds-a-longest-line-trigger.md) The guard gains a longest-line trigger.
- [0022](0022-source-mode-gets-its-own-guard-keyed-on-table-row-density.md) Source mode has its own guard, keyed on table-row density, that disables table extensions.
- [0026](0026-wysiwyg-scroll-spy-is-geometric.md) WYSIWYG scroll spy is geometric.
  - [0018](0018-bottom-of-document-stranded-heading-count.md) Measurement correction: the stranded-heading count at the bottom of a document.
  - [0041](0041-wysiwyg-scroll-targets-are-pinned-for-a-bounded-settle-window.md) Scroll targets are pinned for a bounded settle window.
- [0043](0043-the-source-cursor-context-holds-a-table-span-not-a-table-model.md) The Source cursor context holds a table span, not a table model.
- [0046](0046-source-table-tab-swallows-when-it-owns-the-key-but-cannot-navigate.md) Source-table Tab is swallowed when the table owns the key but cannot navigate.
- [0059](0059-open-documents-live-in-the-tabs-not-in-the-sidebar.md) Open documents live in the tabs, not in the sidebar.
- [0060](0060-a-confirm-prompt-returning-into-the-editor-carries-the-caret.md) A confirm prompt returning into the editor carries the caret.
  - [0061](0061-a-prompt-that-opens-after-the-capture-also-carries-the-caret.md) A prompt that opens after the capture also carries it.
- [0062](0062-app-level-dialogs-render-in-open-order.md) App-level dialogs render in open order.
  - [0045](0045-modal-escape-goes-to-the-last-dialog-in-dom-order.md) Escape goes to the last dialog in DOM order.
  - [0048](0048-escape-swallowed-by-an-ime-is-not-recovered-from-keyup.md) An Escape swallowed by an IME is not recovered from keyup.
  - [0079](0079-the-encoding-and-reload-dialogs-join-the-escape-stack.md) The encoding and reload dialogs join the Escape stack.
  - [0108](0108-an-mcp-prompt-waits-while-another-modal-is-open.md) An MCP prompt waits while another modal is open.
  - [0116](0116-the-startup-recovery-prompt-waits-while-another-modal-or-a-received-mcp-prompt-is-pending.md) The startup recovery prompt waits for another modal or a received MCP prompt.
- [0063](0063-table-edits-widen-like-format-on-save.md) Table edits widen ragged tables the way format-on-save does.
  - [0064](0064-mcp-table-actions-widen-and-keep-header-width-coordinates.md) MCP table actions widen and keep header-width coordinates.
  - [0067](0067-wysiwyg-widens-ragged-tables-at-parse-time.md) WYSIWYG widens ragged tables at parse time.
- [0088](0088-the-sidebar-keeps-its-width-is-resizable-and-is-toggled-by-one-fixed-button.md) The sidebar keeps its width, is resizable, and is toggled by one fixed button.
- [0091](0091-an-empty-wysiwyg-paragraph-is-saved-as-blank-lines-and-read-back-by-count.md) An empty WYSIWYG paragraph is saved as blank lines and read back by count.
- [0094](0094-link-reference-definitions-are-kept-as-visible-blocks-and-references-are-inlined.md) Link reference definitions stay visible blocks; references are inlined.
- [0099](0099-wysiwyg-list-markers-are-written-through-a-wrapped-stock-list-handler.md) WYSIWYG list markers are written through a wrapped stock list handler.
- [0106](0106-five-control-colours-are-accepted-below-the-a9-contrast-line.md) *Known defect:* five control colours are accepted below the A9 contrast line.
- [0110](0110-code-surfaces-take-the-neutral-derived-background.md) Code surfaces take the neutral derived background. (Under today's bar this would be a below-the-bar
  record.)
- [0114](0114-the-menu-bar-and-default-keys-follow-one-command-table-and-vmark.md) The menu bar and default keys follow one command table, modelled on VMark.
  - [0096](0096-on-windows-and-linux-ctrl-digits-are-headings-and-ctrl-slash-switches-the-view.md) *Partial:* off-Mac Ctrl+digits are headings and Ctrl+/ switches the view; 0114 replaced the rest.
- [0136](0136-source-mode-gets-an-opt-in-prefix-navigation-layer.md) Source mode gets an opt-in prefix navigation layer.
- [0010](0010-continue-vs-rewrite.md) *Proposed:* continue the codebase rather than rewrite it.

### Files, save, watcher, windows and quit

- [0005](0005-lock-span-invariant-is-review-enforced.md) The preferences lock-span invariant is held by review, not by test hooks.
- [0025](0025-app-quit-is-deferred-through-a-native-terminate-hook.md) App quit is deferred through a native terminate hook and one coordinator.
  - [0027](0027-a-quit-ack-timeout-draws-a-native-alert.md) A quit-ack timeout draws a native alert.
  - [0029](0029-quit-deadlines-bound-machine-progress-not-people.md) Quit deadlines bound machine progress, not people.
  - [0030](0030-a-menu-item-is-the-escape-hatch-for-a-stuck-quit.md) A menu item is the escape hatch for a stuck quit.
  - [0035](0035-a-window-that-answered-the-quit-prompt-is-re-checked-before-commit.md) A window that answered the quit prompt is re-checked before commit.
  - [0036](0036-the-stuck-quit-escape-hatch-is-an-always-enabled-app-menu-item-without-a-shortcut.md) The escape hatch is an always-enabled app-menu item without a shortcut.
  - [0066](0066-no-new-windows-while-a-quit-request-is-live.md) No new windows while a quit request is live.
- [0028](0028-reopening-a-dirty-open-file-focuses-it-instead-of-reloading.md) Reopening a dirty open file focuses it instead of reloading.
- [0031](0031-preference-persistence-is-restored-in-dependency-order.md) Preference persistence is restored in dependency order.
  - [0053](0053-only-explicit-view-mode-commands-persist-last-view-mode.md) Only explicit view-mode commands persist the last view mode.
- [0033](0033-an-external-open-of-an-already-open-file-goes-to-its-window.md) An external open of an already-open file goes to its window.
- [0037](0037-global-window-state-belongs-to-main.md) Global window state belongs to the main window.
- [0051](0051-rust-owns-the-session-recent-files-list.md) Rust owns the session recent-files list.
- [0057](0057-the-encoding-dialog-never-offers-an-encoding-that-cannot-be-right.md) The encoding dialog never offers an encoding that cannot be right, and Cancel is safe. (It replaces the
  encoding half of 0056.)
- [0068](0068-file-watcher-drops-metadata-and-content-events-when-the-file-is-unchanged.md) The file watcher drops metadata and content events when the file is unchanged.
  - [0072](0072-a-replaced-watched-file-is-checked-like-a-content-change.md) A replaced watched file is checked like a content change.
  - [0078](0078-a-watched-file-moved-away-is-reported-as-deleted.md) A watched file moved away is reported as deleted.
  - [0080](0080-permission-and-ownership-changes-on-an-unchanged-file-do-not-prompt.md) Permission and ownership changes on an unchanged file do not prompt.
  - [0109](0109-a-modify-on-a-gone-watched-path-is-reported-as-deleted.md) A modify on a gone watched path is reported as deleted.
  - [0111](0111-a-change-of-state-restarts-the-watcher-debounce.md) A change of state restarts the watcher debounce.
- [0071](0071-a-failed-wysiwyg-flush-refuses-activation.md) A failed WYSIWYG flush refuses activation.
- [0081](0081-external-changes-are-kept-per-document-and-an-open-reports-a-change-since-its-read.md) External changes are kept per document; an open reports a change since its read.
- [0086](0086-a-save-tells-every-other-holder-and-the-watch-is-owned-per-canonical-group.md) A save tells every other holder; the watch is owned per canonical group.
- [0093](0093-windows-reads-are-proven-stable-by-file-identity-and-the-self-write-gate-matches-every-spelling.md) Windows reads are proven stable by file identity; the self-write gate matches every spelling.
- [0112](0112-closing-a-secondary-windows-last-tab-closes-the-window-and-closing-the-last-window-quits.md) Closing a secondary window's last tab closes the window; closing the last window quits.
- [0127](0127-recover-merges-into-a-tab-of-the-calling-window-and-an-in-use-refusal-is-told.md) Recover merges into a tab of the calling window, and an in-use refusal is told (claim tokens).
  - [0038](0038-a-draft-in-use-by-a-live-window-is-not-offered-for-recovery.md) *Partial:* a draft in use by a live window is not offered for recovery; 0127 amended refusal and placement.
  - [0056](0056-recovery-stays-a-forced-choice-and-encoding-opens-on-cancel.md) *Partial:* recovery stays a forced choice. Its encoding half (open on Cancel) is replaced by 0057 and must not
    come back.

### Export and link security

- [0002](0002-link-click-routing-and-origin-comparison.md) Link clicks are routed by scheme, with an origin comparison before anything opens outside the app.
- [0003](0003-export-fragment-sanitizer-scope.md) The sanitizer applies to the export fragment only.
  - [0011](0011-remove-name-from-export-sanitizer-allowlist.md) `name` is removed from the export sanitizer allowlist.

### MCP, IPC and startup

- [0021](0021-mcp-document-offsets-are-utf16-code-units.md) MCP document offsets are UTF-16 code units.
- [0024](0024-mcp-table-actions-report-their-outcome-by-ack-round-trip.md) MCP table actions report their outcome by an ack round trip.
- [0040](0040-the-mcp-server-switch-takes-effect-live.md) The MCP server switch takes effect live.
  - [0054](0054-a-locked-mcp-switch-mirrors-the-running-server.md) A locked MCP switch mirrors the running server.
- [0042](0042-mcp-write-confirmation-is-an-in-window-queued-prompt.md) MCP write confirmation is an in-window queued prompt.
- [0044](0044-mcp-insert-in-wysiwyg-is-a-wholesale-replace.md) MCP insert in WYSIWYG is a wholesale replace.
- [0065](0065-mcp-table-actions-flush-first-and-commit-the-editor-before-the-store.md) MCP table actions flush first and commit the editor before the store.
- [0166](0166-mdpro-owns-macos-single-instance-admission-and-forwarding.md) mdpro owns macOS single-instance admission and forwarding. Accepted, not yet enforced; it replaces only
  0047's macOS plugin choice, not the verification channel.

### Platform and release

- [0069](0069-releases-bump-the-patch-number-only.md) Releases bump the patch number only.
- [0073](0073-release-workflow-auto-publishes-only-after-verifying-the-uploaded-draft.md) The release workflow publishes only after verifying the uploaded draft.
- [0101](0101-macs-on-macos-13-0-can-be-updated-to-a-build-they-cannot-open.md) *Known defect:* Macs on macOS 13.0 can be updated to a build they cannot open.
- [0132](0132-d294-secondary-window-close-crash-ships-as-a-known-issue-with-a-0-3-7-fix-by.md) *Known defect:* the D294 secondary-window close crash ships as a known issue with a 0.3.7 fix-by.
- [0160](0160-development-continues-on-master-under-a-feature-freeze-until-0-3-6.md) *Release history:* development continued on `master` under a feature freeze until 0.3.6; the freeze has
  ended, and 0164 amended the release condition.
- [0164](0164-0-3-6-ships-macos-and-linux-only-and-windows-waits-for-its-device-batch.md) *Release history:* 0.3.6 ships macOS and Linux only; Windows waits for its device batch.
- [0070](0070-0-3-1-ships-without-notarization.md) *Release history:* 0.3.1 ships without notarization.
- [0075](0075-0-3-1-ships-without-in-editor-drag-and-drop.md) *Release history:* 0.3.1 ships without in-editor drag and drop.
- [0090](0090-windows-and-linux-quit-through-the-quit-guard.md) *Proposed, partial:* Windows and Linux quit through the quit guard.

### Tooling dependencies and the verification build

- [0006](0006-bump-micromark-gfm-table-for-quadratic-edit-map.md) micromark's GFM table extension is bumped to fix a quadratic edit map.
- [0023](0023-one-lint-rule-enters-as-a-typescript-parser-script.md) The one lint rule enters as a TypeScript parser script; ESLint is refused.
- [0047](0047-agents-verify-in-the-real-app-through-a-feature-gated-control-channel.md) Agents verify in the real app through a feature-gated control channel.
  - [0058](0058-a-verify-run-publishes-its-handshake-once-and-never-replaces-it.md) A verify run publishes its handshake once and never replaces it.
- [0082](0082-mdpro-patches-prosemirror-tables-for-the-overlong-rowspan-cell-paste.md) mdpro patches prosemirror-tables for the overlong rowspan-cell paste.
- [0122](0122-the-updater-drops-its-zip-feature-instead-of-ignoring-zip-advisories.md) The updater drops its zip feature instead of ignoring zip advisories.
- [0163](0163-fast-check-for-typescript-data-shape-properties-race-models-keep-the-enumerator.md) fast-check for TypeScript data-shape properties; race models keep the enumerator.

### Charter

- [0165](0165-adrs-record-architecture-and-product-decisions-only.md) ADRs record architecture and product decisions only; process decisions go to the decision log. The one
  process ADR kept, as the log's charter.

## Process records

These ADRs decide how the work is done. None is declared non-binding here. *Folded* means the named clauses now live in
the home given; *not yet folded* means the ADR still governs its unfolded clauses, even where the home already says the
same thing.

| Topic | ADRs | Current home | Fold state |
|---|---|---|---|
| Audit shape, rounds, tiers and context | [0085](0085-a-branch-is-audited-before-it-is-fast-forwarded-onto-master.md), [0115](0115-every-pre-landing-audit-runs-twice-codex-and-fable-on-the-same-dimensions.md), [0121](0121-audit-effort-follows-risk-pre-existing-findings-do-not-block-and-auditors-are-measured.md), [0129](0129-a-high-that-survives-the-audit-cap-is-classified-tracked-and-expires.md), [0131](0131-every-audit-request-and-every-fix-round-starts-from-a-fresh-context.md), [0143](0143-every-audit-runs-gpt-auditor-and-opus-auditor-together-capped-at-two-rounds.md) | [landing-and-audit.md](../../.agents/skills/mdpro-delegator/references/landing-and-audit.md#audit-merge) (§ Audit merge, § Tiers, § After the cap, § Requests) | Folded, named clauses |
| Audit dimensions | [0146](0146-audits-use-project-dimensions-kept-in-the-repo.md) | [auditor.md](../agents/auditor.md#dimensions) | Folded, named clauses |
| Roster, panes and runtime | [0124](0124-two-implementation-slots-and-a-herdr-mixed-model-roster-overlays-rule-70.md), [0133](0133-a-third-codex-implementor-takes-low-tier-items-and-every-codex-agent-runs-with-a-context-cap.md), [0134](0134-the-herdr-roster-moves-to-the-mac-mini-isolated-from-picsee.md), [0137](0137-the-second-auditor-runs-on-opus-as-the-opus-auditor-pane.md), [0140](0140-a-codex-session-may-hold-the-delegator-role.md) | [roster-and-routing.md](../../.agents/skills/mdpro-delegator/references/roster-and-routing.md#roster) (§ Overlay, § Roster, § Runtime route); [codex-panes.md](../../.agents/skills/mdpro-delegator/references/codex-panes.md#restart) | Folded, named clauses |
| Effort and model routing | [0138](0138-effort-follows-task-difficulty-and-audits-read-from-the-diff-outward.md), [0139](0139-routine-implementor-items-run-on-gpt-6-luna-high-as-a-pilot.md) | [roster-and-routing.md](../../.agents/skills/mdpro-delegator/references/roster-and-routing.md#effort) | Folded, named clauses |
| Codex command guards | [0141](0141-codex-command-rules-are-scoped-by-role-and-the-delegator-lands-through-checked-scripts.md) | [AGENTS.md](../../AGENTS.md#command-guards-codex) | Folded, named clauses |
| Queues and slots | [0097](0097-idle-sessions-pull-prep-from-a-queue-and-implement-only-under-a-grant.md), [0156](0156-three-implementation-slots-and-opus-imple-2-joins-the-roster.md) | [session-ops.md](../../.agents/skills/mdpro-delegator/references/session-ops.md#queues); [rule 71](../../.claude/rules/71-herdr-mixed-roster.md#slots) | 0097 folded; 0156 not yet folded |
| Trunk, branches and landing | [0083](0083-master-is-the-single-integration-trunk.md), [0084](0084-remote-branches-are-kept-thirty-days-after-their-work-lands.md), [0095](0095-pull-request-ci-is-a-landing-gate.md), [0157](0157-a-landed-branchs-worktree-is-removed-at-landing-without-asking.md) | [rule 70](../../.claude/rules/70-multi-session-coordination.md#commits-and-branches); [landing-and-audit.md](../../.agents/skills/mdpro-delegator/references/landing-and-audit.md#landing) | 0095 folded, named clauses; 0083, 0084, 0157 not yet folded |
| Record-checked landing | [0159](0159-landing-is-checked-against-the-records-by-one-command-and-policy-files-land-by-pr.md) | The ADR (Proposed; finishes under the old flow) | Not yet folded |
| Planning gate and instruction routing | [0147](0147-always-on-instructions-become-a-routing-map.md), [0148](0148-new-features-pass-grill-spec-and-tickets-before-implementation.md) | [rule 12](../../.claude/rules/12-feature-planning-gate.md); [landing-and-audit.md](../../.agents/skills/mdpro-delegator/references/landing-and-audit.md#gated-items); the D355 fold-in entry in the [decision log](../agents/decisions/README.md#entries) | 0148 folded; 0147 partly folded and changed, its later clauses still govern |
| Test lanes and placement | [0049](0049-dom-free-test-files-opt-into-the-node-environment.md), [0050](0050-exhaustive-tests-run-in-a-separate-slow-lane.md), [0074](0074-the-menu-events-d3-and-a9-properties-move-to-the-slow-lane.md), [0098](0098-launcher-tooling-and-perf-tests-move-into-their-own-folders-under-tests.md), [0130](0130-ci-coverage-runs-in-shards-workers-follow-load-and-test-timeouts-are-liveness-bounds.md) | [rule 10](../../.claude/rules/10-tdd.md#environment-and-the-slow-tier) (§ Environment and the slow tier, § File placement, § How much to run, and when) | Not yet folded |
| Receipts and replay | [0125](0125-frontend-red-receipts-run-one-validated-test-file-not-the-full-coverage-lane.md), [0145](0145-a-broken-red-receipt-carries-its-own-evidence-and-the-auditors-rule-on-it.md), [0149](0149-a-broken-receipt-is-judged-by-a-base-tree-fail-to-pass-replay.md) | [receipt-evidence.md](../guide/receipt-evidence.md#commands) (§ Commands, § Evidence and engine, § The replay) | Not yet folded |
| TDD skill | [0161](0161-implementors-follow-one-project-skill-jack-tdd-workflow-and-codex-retires-tdd-guardian.md) | [implementor.md](../agents/implementor.md#matrix-and-attack) | Not yet folded, by design, until T-02's go-live |
| CI coverage and dependency audit | [0107](0107-cargo-audit-runs-in-its-own-job-outside-the-landing-gate.md), [0128](0128-the-coverage-gate-runs-in-ci-and-the-verifier-stops-repeating-the-full-lane.md) | The ADRs and the CI workflows | Not yet folded |
| Heavy and GUI lock | [0135](0135-one-heavy-lock-tool-serves-every-project-queues-in-arrival-order-and-admits-by-memory.md), [0150](0150-heavy-and-gui-runs-exclude-each-other-and-a-load-guard-stops-a-job-under-memory-or-cpu-overload.md), [0151](0151-heavy-jobs-are-admitted-against-a-memory-budget-and-cpu-stops-only-the-job-that-causes-it.md), [0152](0152-an-unreadable-memory-pressure-reading-on-macos-holds-the-job.md), [0153](0153-admission-needs-the-jobs-own-budget-plus-one-gib-free.md), [0154](0154-admission-reads-macos-own-available-memory-figure.md), [0155](0155-a-gui-keeper-holds-the-heavy-lock-in-a-holding-state-and-releases-itself-when-its-gui-lock-is-gone.md) | The ADRs and `scripts/heavy-lock.sh` | Not yet folded |
| Device checks and journeys | [0032](0032-the-preference-round-trip-is-a-gui-acceptance-criterion.md), [0034](0034-a-local-real-app-journey-lane-runs-before-release.md), [0087](0087-device-check-hook-events-are-spooled-on-the-mini-and-replayed-in-sequence.md), [0103](0103-the-e2e-journey-catalogue-is-the-single-source-for-device-checks.md), [0104](0104-the-ledger-gate-requires-a-journey-or-a-tested-exemption-on-each-platform.md), [0105](0105-the-control-channel-runner-and-feature-map-read-the-journey-catalogue.md), [0144](0144-behaviour-acs-are-proved-in-the-real-app-before-landing.md) | [device-tester.md](../agents/device-tester.md#cards) for 0144; the ADRs for the rest | 0144 folded; the rest not yet folded (0034, 0087, 0105 and parts of 0103, 0104 are Proposed) |
| Release rehearsal and the verify launcher | [0076](0076-verify-release-gains-a-rehearsal-only-check-mode.md), [0077](0077-the-verify-launcher-lock-is-serialised-by-an-outside-mutex.md) | [release-runbook.md](../guide/release-runbook.md#rehearsals) for 0076; the ADR for 0077 | Not yet folded |
| Gate waivers, performance budgets, ledger platform state | [0004](0004-gate2-waiver-for-stage3-entry.md), [0055](0055-a-missed-performance-budget-changes-the-design-not-the-number.md), [0089](0089-the-feature-ledger-records-windows-state-in-a-per-area-difference-table.md) | The ADRs; the feature-ledger header for 0089 | Not yet folded |

## History

| ADR | Successor or reason |
|---|---|
| [0001](0001-wysiwyg-link-scheme-allowlist.md) | Superseded by ADR-0002. |
| [0007](0007-table-scanner-emits-non-overlapping-models.md) | Superseded by 0008's corrected characterization. |
| [0017](0017-source-scroll-spy-bottom-of-document-asymmetry.md) | Superseded by 0018's stranded-heading correction. |
| [0020](0020-eslint-enters-as-a-single-rule-devdependency.md) | Proposed, never accepted; replaced by ADR-0023. |
| [0039](0039-mcp-server-enablement-is-read-once-at-launch.md) | Superseded by ADR-0040. |
| [0052](0052-format-on-save-widens-tables-to-the-widest-row.md) | Superseded by ADR-0063. |
| [0100](0100-the-s2-negative-control-is-a-minimal-confirmdialog-patch.md) | Spent: the S2 driver-selection experiment, finished under 0047. |
| [0102](0102-v0-3-4-ships-with-a-failing-update-check-on-windows-and-linux.md) | Spent: the 0.3.4 update-check defect, fixed in 0.3.5 (`CHANGELOG.md`). |
| [0113](0113-the-s2-control-takes-focus-out-of-the-dialog-with-one-backdrop-click.md) | Spent: the S2 backdrop-click protocol, narrowed by 0117. |
| [0117](0117-a-relayed-remote-key-stands-for-the-physical-esc-in-the-spikes-s2-runs.md) | Spent: restricted to the named, finished S2 runs. |
| [0118](0118-three-implementation-slots-and-opus-reviews-adrs-and-plans.md) | Replaced by 0156 (slots), 0137 (Opus pane), 0143 (audits) and 0165 (review route). |
| [0119](0119-four-implementation-slots-machine-wide.md) | Replaced by 0124, then 0156. |
| [0120](0120-a-pre-landing-audit-runs-at-most-three-rounds-then-the-user-rules.md) | Replaced by 0143 (rounds) and 0129 (after the cap). |
| [0142](0142-an-opus-auditor-review-runs-at-most-two-rounds-then-the-user-decides.md) | Superseded by ADR-0143. |
| [0158](0158-toggle-sidebar-defaults-to-ctrl-shift-1-on-windows.md) | Rejected: a vendor hotkey caused the problem; 0114's default stays. |
| [0162](0162-rework-countermeasures-before-0-3-6-and-a-process-freeze.md) | Expired at 0.3.6, as the D355 fold-in entry records; its receipt policy survives elsewhere. |
