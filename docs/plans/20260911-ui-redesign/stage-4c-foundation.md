# UI redesign plan — Stage 4c: cross-cutting foundations

Part of [the UI redesign plan](../20260911-plan-ui-redesign.md), which holds the sources of truth, decisions, open questions, acceptance criteria and tasks.

## Stage 4c — Foundations (part of Stage 4, Deliverable C)

Stage 4's entry condition, acceptance criteria, commit split and worktree lanes are in [`stage-4a-components.md`](stage-4a-components.md).

These five work items came out of the round-2 and round-4 engineering reviews (E16, E19, E20, E22, E23; E35, E37, E38). None of them changes a pixel. They are grouped here because each one is cross-cutting: every one touches files that several Stage 4 lanes also touch, so each must land on its own, between lanes, rather than inside one.

**Order.** The round-2 review fixed the order by correctness risk, not by visibility: **WI-4.21 (E23) → WI-4.18 (E21) → WI-4.19 (E19) → WI-4.17 (E18) → WI-4.16 (E17) → WI-4.20 (E20) → WI-4.22 (E22)**. WI-4.18, WI-4.17 and WI-4.16 live in [`stage-4b-data-safety.md`](stage-4b-data-safety.md). One reservation is recorded against this order: WI-4.16 is the only item with a user-visible symptom and it is a one-site fix, so it may be pulled earlier if the schedule allows. The ordering was accepted anyway, because the items ahead of it carry the higher correctness risk. **Round-4 amendment (E35, E36):** WI-4.22 is rewritten to own the render-ownership table and now lands **before WI-4.8** as well as before WI-4.12, and a fifth item, **WI-4.26**, lands after it and before WI-4.8.

### WI-4.19 — One cancellation-safe subscription primitive (E19) — M
- **Order:** before any lane, and before WI-4.12, which registers a drag listener of its own.
- **Why:**
  - Six `listen()` sites assign `unlisten` only after an `await` or a `.then()`, with no cancellation flag, so a cleanup that runs before registration completes never unsubscribes: `App.tsx:374-396`, `App.tsx:868-892`, `App.tsx:1089-1103`, `useMenuEvents.ts:125-137`, `useMcpEvents.ts:313-351`, `useTheme.ts:22-42`.
  - `useFileWatcher.ts:28-61` already has the correct shape (a `cancelled` flag) and is the model.
  - Tauri's `listen()` registers a **new** callback per call (`@tauri-apps/api/event.js:74`); it does not replace. A leaked registration therefore duplicates menu actions and duplicates document creation — behavior, not housekeeping.
  - `useMenuEvents.ts` re-subscribes on a 14-entry dependency array, so a handler-identity fix alone would keep churning subscriptions.
- **Correction carried forward:** an earlier draft of this finding claimed `useTheme`'s `.then()` makes the cleanup run synchronously. It does not — React runs cleanup at unmount or re-run. The leak needs cleanup to precede the completion of registration, which is still reachable.
- **The primitive** (assumption: `src/hooks/useTauriEvent.ts`):
  - It takes a **registration factory** plus a handler, and subscribes on **event name / window / enabled** identity — never on handler identity.
  - The handler is held in a ref committed in a layout effect, so the live handler is current without re-subscribing.
  - Cleanup sets a cancellation flag and calls `unlisten` if registration already resolved; a registration that resolves after cancellation unsubscribes immediately.
- **Migration:** all nine sites move to it. Re-grep before starting; earlier work items move these line numbers.
- **Tests** (through tdd-guardian, RED first):
  - **Regression:** unmounting before the registration promise resolves still unsubscribes. This test fails against today's `App.tsx` and `useTheme.ts`.
  - A handler change does not re-register; the newest handler still receives the event.
  - A changed event name or window does re-register, and unsubscribes the old one.
  - Two mounts register twice and unmount to zero live listeners.
- **Logging:** none. A subscription is not a user action.

### WI-4.20 — One logged-operation wrapper for Tauri commands (E20) — M
- **Order:** after WI-4.16, which settles the error shape the wrapper reports.
- **Why:**
  - `save_file` validates the path at `file.rs:1170` and only then derives the action id and writes its Start log (`:1172-1176`). A rejected path — the security-relevant case — logs **nothing at all**.
  - `commands/preferences.rs:35,48` already has the right shape and is the model.
  - `fileService.ts:35-36,63-66` does forward `actionId`, and `file.rs:1172` honours a supplied id, so correlation already works; it does not need 45 signatures changed.
- **The wrapper:** `loggedOperation` logs Start **before** any validation, then derives exactly one terminal outcome from the returned `Result`.
- **Rejected:** an RAII guard, because it cannot see the error value and misclassifies cancellation as failure; and a grep gate as the primary mechanism, though one may stay as a cheap backstop.
- **Known limit, recorded rather than solved:** a wrapper cannot observe argument-**deserialization** failures. Tauri deserializes before the command body runs, so those failures stay invisible to it. `create_document`, which logs nothing today, is brought into the wrapper in the same item.
- **Tests** (through tdd-guardian, RED first; `cargo test`):
  - **Regression:** `save_file` with an invalid path emits a Start log and exactly one terminal `fail`. This test fails today.
  - A success emits exactly one terminal `ok`, never both.
  - A supplied `actionId` appears on both the Start and the terminal record; an absent one is generated once and reused.
  - `image.rs`'s dangling starts each gain a terminal record.

### WI-4.21 — MCP window routing and Zustand selectors (E23) — S
- **Order:** first of the four, per the fix order above. It touches `http_server.rs` and `useMcpEvents.ts`, which no lane touches.
- **Why:**
  - `http_server.rs:694-704` emits with `window_label: None` after generating a fresh id.
  - The frontend guard at `useMcpEvents.ts:279-281` is falsy-gated, so a null label passes it in **every** open window. Each window then creates the document, and `:285` sets `id: event.document_id`, so all of those copies share one UUID.
  - `AdvancedSettings.tsx:20-21` destructures `useLoggingStore()` with no selector, against rule 50 § 1. `loggingStore.ts:4-10` holds two data fields and three setters, so every setter call re-renders the whole panel.
- **Routing moves to Rust:** the backend resolves one live destination and calls `emit_to(label, …)` with a **non-null** payload label. With no eligible window it returns an error instead of broadcasting. A frontend election across windows is racy and is rejected.
- **Frontend guard stays** as defence in depth, but compares against a concrete label rather than a falsy check.
- **Selectors:** the two violations are replaced with field selectors, and a lint rule (`no-restricted-syntax`) forbids zero-argument calls to the known Zustand hooks, so the class cannot come back.
- **Tests** (through tdd-guardian, RED first):
  - **Regression:** with two windows registered, an MCP `create_document` reaches exactly one and creates exactly one document. This test fails today.
  - No eligible window returns an error and emits nothing (`cargo test`).
  - A payload whose label does not match the current window is ignored.
  - The lint rule fails on a zero-argument store call and passes on a selector call.
- **Logging:** the emit records the resolved window label; the no-window case logs `fail` with a reason.

### WI-4.22 — File-size ratchet and the `App.tsx` lifecycle seam (E22, E16) — M
- **Order:** last of the round-2 four. It is the only one that moves large amounts of code, so it lands when the other three have settled their files. It then lands **before WI-4.8 and before WI-4.12** (E35).
- **Why:**
  - Rule 50's 300-line limit is currently advisory in practice: **19 production files** exceed it.
  - Correction carried forward: an earlier draft said 24. That count included inline Rust `#[cfg(test)]` modules. Production-only counts: `markdown.rs` 1528 raw → 687, `file.rs` 1421 → 401, `http_server.rs` 1314 → 1084.
  - `App.tsx` at 1194 production lines is the **largest production file in the repo**, ahead of `http_server.rs` at 1084. It holds the document lifecycle, the close confirmation, drag-and-drop and eight subscriptions at once. That concentration, not the rule statistic, is the engineering risk.
- **Ratchet:** enforced for new production files; existing offenders are baselined with their current counts; unexplained growth of a baselined file is rejected. The baseline list is generated from production lines only, excluding `#[cfg(test)]` modules.
- **The seam (E16):** a document-lifecycle controller with injected file, editor and window services, plus a presentational dialog host. `App.tsx` keeps layout and wiring. This is deliberately **not** one giant hook created to satisfy rule 50.
  - This extraction runs **before** WI-4.12's drop-target extraction, so the drag work lands on the new seam rather than being moved twice.
  - The same stage replaces the source-text assertions covering this area with behavior tests.
- **Render ownership (E35, E32) — the part this item was missing.** As previously written, WI-4.22 promised testability and line count but never said whether the controller is a hook or a separate component. A hook keeps the eight subscriptions inside App's render scope, which relocates code while leaving the render topology unchanged and forces a second split later. The controller is therefore **not** a hook called from App's render body. Each subscription gets a named owner:

  | Subscription / concern | Owner after WI-4.22 | Rule |
  |---|---|---|
  | Layout, theme, structural visibility, stable wiring | `App.tsx` | May subscribe only to scalars and stable action identities |
  | Document content (`documents`, `activeDocument.content`) | Editor host | App must not read content, including transitively through a hook |
  | Document lifecycle (open, close, confirm, discard) | Lifecycle controller | Exposes stable commands; reads the store **when called**, never during render |
  | MCP synchronization (`useMcpSync`, `documents` at `:41`) | Background owner outside App's render scope | Moving `useDocument` alone is insufficient — App calls this too |
  | TOC scheduling (`useTOC`) | Background owner outside App's render scope | Same; `useTOC.ts:60` also drops its zero-argument destructure (rule 50 § 1) |
  | Cursor position | Cursor field only | A cursor move re-renders no other field |

  - Memo boundaries are placed **precisely at independently-updating regions**, not wrapped around all 38 exported components: a memo on a component whose props change every keystroke only adds comparison cost.
  - Out of scope here by decision, not deferral: store normalization (E34), and the `TextEncoder` size-guard semantics at `App.tsx:508-514` (E36).
- **Known bug fixed here:** `App.tsx:925` calls `closeActiveDocument(true)`, which closes whatever is active at confirm time rather than the document the confirmation was opened for.
- **Tests** (through tdd-guardian, RED first):
  - **Regression:** request close on document A, activate B, then confirm — A closes and B stays open. This test fails today.
  - The controller's lifecycle paths with the services faked: open, close clean, close dirty, discard, cancel.
  - The ratchet check fails on a new over-limit production file and on growth of a baselined file, and passes on a shrinking one.
  - The ratchet's line counter ignores `#[cfg(test)]` modules, proven on a fixture.
  - **Ownership (E35, E39):** 100 content updates applied in **separate `act` steps** produce zero additional commits in App, the tabs, the sidebar, the dialog host and the toast host. A single batched update is rejected as a test shape, because React coalesces it and hides the propagation under test.
  - A static check proves App reads no content, no whole `documents` array and no cursor coordinate, including transitively through a hook.
  - Lifecycle commands keep stable identities across a content change.
- **Logging:** unchanged; the extracted controller keeps the existing `tab.*` and `file.*` events and their action ids.

### WI-4.26 — Change-detection and TOC subscription correctness (E37, E38 in part) — S
- **Order:** after WI-4.22, before WI-4.8. Both fixes are **correctness**, not performance; they are grouped here because both live in the subscription layer WI-4.22 just rearranged. WI-4.22 already owns `useMcpSync.ts`, so **WI-4.22 → WI-4.26 → WI-4.8 stays strictly serial.**
- **Scope narrowed (cross-plan sequencing, 2026-09-12; see the index's "Cross-plan sequencing" section):** heading-identity reconciliation is **no longer delivered here**. It moves to [`20260912-plan-markdown-source-consolidation.md`](../20260912-plan-markdown-source-consolidation.md), whose heading contract and TOC switch land **before WI-0.1**, so this item may assume that contract already exists. Reason: the identity this item would have reconciled on is not unique today. `tocService.ts:101-111` keys its counter on `baseId` alone and emits `x`, `x-1`, `x-1` for `# x` / `# x` / `# x-1`; its `return id || "heading"` (`:111`) runs after the counter and never registers `"heading"`, so an emoji-only heading collides with a literal `# heading`; `exportService.ts:47-58` is byte-identical, so both surfaces carry both defects. Reconciling on that identity here would pin a colliding contract into this plan's acceptance criteria.
- **Why (E37):** `useMcpSync.ts:139` builds the change hash from `` `${d.id}:${d.content.length}:${d.isModified}` ``. An equal-length replacement in an already-dirty document — a typo fix, `foo` → `bar` — leaves the hash unchanged and schedules **no sync at all**, so MCP tools then read a stale shadow store with no error anywhere. `doSync` separately serializes all open content into `JSON.stringify(payload)` (`:84`) as a dedup hash and retains a second full copy in `lastSyncRef.current`.
- **Why (E38):** `tocStore.ts:86-88` — `setEntries: (entries) => set({ entries, activeEntryId: null, collapsedIds: new Set<string>() })` — resets collapse state and the active entry on every re-parse, so typing discards what the user collapsed. `useTOC.ts:60` also destructures `useTOCStore()` with no selector (rule 50 § 1, the class WI-4.21 lints for). **Split by the scope narrowing:** the `setEntries` reset is fixed in plan M, together with the identity contract it depends on; only the `useTOC` selector change remains here.
- **The fixes:** the MCP change detector keys on a content **revision or digest**, never on length; `useTOC` moves to field selectors. Collapse-state reconciliation by heading identity, and preservation of the active entry, belong to plan M — not to this item.
- **Rule carried forward:** no scheduler introduced later may key on content length — including WI-4.8's word-count scheduler (E33).
- **Tests** (through tdd-guardian, RED first):
  - **Regression:** an equal-length edit in an already-dirty document schedules a sync and the shadow store receives the new text. This test fails today.
  - *Moved to plan M with the identity contract:* collapse a heading, type elsewhere, re-parse — the heading stays collapsed and the active entry survives; and a heading that no longer exists drops out of the collapse set rather than accumulating. Both fail today. Plan M additionally asserts that every id in one document is pairwise distinct, which also fails today.
  - The lint rule from WI-4.21 rejects `useTOC.ts`'s old zero-argument call.
- **Logging:** the MCP sync path keeps its existing events; no new user action.

### Stage 4c acceptance criteria
- [ ] G0 passes; every work item here has its RED→GREEN tests (rule 10)
- [ ] No `listen()` call site assigns `unlisten` after an `await` without a cancellation flag; all nine go through the WI-4.19 primitive, and a mount/unmount cycle leaves zero live listeners
- [ ] Every `#[tauri::command]` that validates input logs Start before validation and exactly one terminal outcome; `save_file` with a rejected path produces both records
- [ ] An MCP tool call with two windows open creates exactly one document, and no MCP event carries a null window label out of Rust
- [ ] No zero-argument Zustand hook call remains in `src/`, and the lint rule rejects a new one
- [ ] The production-line ratchet is in CI with its baseline recorded; `App.tsx` is below its baseline, and the close-confirmation regression passes
- [ ] The WI-4.22 ownership table is true and asserted: App reads no content, no whole `documents` array and no cursor coordinate, including transitively through a hook; 100 content updates in separate `act` steps produce zero additional commits in App, the tabs, the sidebar, the dialog host and the toast host (E35, E39)
- [ ] An equal-length edit in an already-dirty document reaches the MCP shadow store, and a collapsed TOC heading survives typing (E37, E38)
- [ ] `CHANGELOG.md` Unreleased covers the user-visible part (MCP routing, save-failure logging, stale MCP content, TOC collapse state)

**Proposed commit split (one per item):**
- `fix(events): cancellation-safe Tauri subscription primitive`
- `fix(logging): log command start before validation`
- `fix(mcp): route document events to one window`
- `refactor(app): document lifecycle seam, render ownership and file-size ratchet`
- `fix(sync): key MCP change detection on content, not length; keep TOC collapse state`

**Rollback:** each item's commit reverts independently. WI-4.22 is the only one with a large diff; it reverts as a unit because the seam and the ratchet baseline are introduced together.
