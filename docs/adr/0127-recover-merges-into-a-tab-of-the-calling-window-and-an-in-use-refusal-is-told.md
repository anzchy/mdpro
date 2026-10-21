# 0127. Recover merges into a tab of the calling window, and an in-use refusal is told

**Status**: Accepted (2026-10-21, by the user after review rounds 1–3: 「Accept with the r3 fixes (Recommended)」). Partially supersedes
[ADR-0038](0038-a-draft-in-use-by-a-live-window-is-not-offered-for-recovery.md) decision 4: its
refusal when the file is open only in the calling window, and "the UI drops the row" for a draft
in use. It also adds rules on when a Protected draft may be overwritten or deleted.

## Context

The D291 device run on `0d34b465` found D299 (BLOCK, data loss;
[record](../test/20261021-d291-device-check.md), item 3).

1. B.md had an unsaved draft, and mdpro was relaunched with `open -a … b.md a.md`.
2. B reopened under its path-derived id, `ce086297ea31788a`. File ids come from the path, so that
   is **the same id its draft has**.
3. The Recovery dialog listed the draft. The listing ran before B's tab reached the shadow store.
4. Recover was refused with `OpenInWindow`, because the draft's own id is open (`owner.rs:114`).
   `draftRecoveryOutcome` maps the refusal to `gone`, which drops the row with no toast.
5. When B's clean tab was closed, the draft was deleted with no log line, and the next launch
   listed nothing.

The deletion was traced on base `7c97166f`. Closing a tab, clean or confirmed dirty, ends in
`close_document` → `discard_and_close`, and that calls `delete_draft(document_id)`
unconditionally (`src-tauri/src/commands/file.rs:1558`, `:1585–1594`). Two more routes can destroy
the same draft once its tab shares its id:
- B's autosave replaces the bundle under that id when B becomes dirty (`useAutoSave.ts:27–33` →
  `draft/mod.rs:133–162`);
- a successful save of B deletes it (`saveService.ts:267–271` → unguarded `delete_draft`), even
  when B's buffer is only the disk text.

ADR-0038 refuses an in-use draft so that two windows never hold the same document. That reason
holds for **another** window. For the calling window, the existing D146/D151 placement
(`recoverIntoOpenTab.ts`) merges into an open clean tab, but it matches only a **different** id and
compares **raw** path strings (`:123–129`). Rust compares canonical paths (`same_file`, ADR-0033). So
the placement misses both the same-id case that D299 hit and aliased paths.

The Recovery dialog is modal and has only Recover and Discard. A row that is refused and kept
therefore has no way out.

## Options considered

- **A. Same-window Recover goes into the matched tab; other refusals are told; pending drafts are
  protected from same-id writes.** (Chosen.)
- **B. Refuse every in-use draft, but toast and keep the row.** Lost: for the relaunch case the
  user would have to close their own tab, which the modal blocks. It is a dead end with a
  message.
- **C. Only stop the close-time deletion.** Lost: the refusal stays silent, and an autosave or
  save can still destroy the text.

User decision, 2026-10-21: 「Merge same-window, else toast (Recommended)」.

## Decision

1. **Recover is allowed when the draft is open only in the calling window**, by its own id or by
   a `same_file` path. Rust decides this at click time, under the draft lock. `recover_draft`
   returns three things:
   - the content;
   - the **target**: the id and stored path of the matched tab in the calling window;
   - a **claim token** for this recovery.

   The frontend places by that target id, never by re-matching path strings:
   - **Target clean, with no other pending draft under its id:** the draft's text goes into that
     tab, marked modified, with no saved baseline (D214).
   - **Target dirty, or another pending draft is under its id:** the draft opens in a new tab under
     a fresh id, with a toast naming the file. The open tab is not touched.
   - The target is re-checked before it is written. If it closed or changed during the await, the
     draft goes to a new tab.

   **Every placement then makes the text durable under its destination id before the row
   resolves.** The frontend writes the recovered text under the destination id with the claim
   token. If the destination id differs from the draft's, the source bundle is then deleted (the
   D146 re-key, now used for every branch). If that write fails, the source bundle stays,
   protected and listable (decision 4), and a toast says the recovery can be retried. Nothing waits
   for the autosave timer.
2. **Still refused, as ADR-0038 says:**
   - an owner that is another live window;
   - the draft's id or file open in **another** window;
   - an unreadable shadow store (fail closed).
3. **An in-use refusal is told, and the dialog gives a way out.** The row stays, and a toast says
   why, e.g. "open in another window". The row also offers **Keep for later**. That drops it from
   this dialog and leaves the draft on disk, to be listed at the next launch (ADR-0038 §3). This
   applies to Recover and to the guarded Discard. A draft already gone (`NotFound`) still leaves
   the list silently.
4. **A draft is protected until a write that carries its claim consumes it.** The rule sits in
   the shared draft service, `save_draft_as` and `delete_draft` under the draft lock, so every
   caller is covered:
   - autosave;
   - the delete after a save;
   - `close_document`;
   - the quit-guard commit's delete of discarded ids (`quit_guard/driver_commit.rs:83`);
   - the D146 re-key.

   The states:
   - **Own:** the bundle's owner is a window of **this** session, and it carries no unconsumed
     claim. Every ordinary autosave stamps the calling window (ADR-0038 §1), so a document nobody
     recovered stays Own. It is written and deleted as today, with no move.
   - **Protected:** the bundle's owner is absent or from another session, or it carries a claim
     that is not yet consumed. That covers:
     - every draft left by an earlier session, including bundles from older builds and claims
       made in an earlier session;
     - a recovered draft whose placement write has not landed.
   - **Consumed:** the placement write carries the token. The token names the source bundle's id
     and its claim nonce. The write lands under the destination id, stamped Own. If the ids differ,
     the source is then deleted, but only if it still holds that same claim. A **stale token**,
     because the source was moved or replaced meanwhile, still writes the destination but deletes
     nothing at the source id. The moved copy stays listed.
   - The bundle's `recovered` flag is not used for any of this, because `save_draft_as` resets it.

   **An operation without the token that targets a Protected bundle's id first moves the bundle**
   to a fresh, random id, then goes ahead:
   - the moved bundle keeps its content, title, original path and timestamps;
   - its claim and owner are cleared, and `recovered` is set to false, so it is listable and age
     cleanup treats it like any unowned draft;
   - the move is logged, with ids only.

   The operation's own write then makes the id Own, so one id is moved at most once per session.
   Nothing Protected is ever overwritten or deleted in place by a tab that never took its text.
   That covers a same-id dirty tab's save, close or Don't Save at quit, before or after a Recover
   into another tab.

   **Two deletes are allowed to remove a Protected bundle**, because removing it is their purpose:
   - the dialog's **guarded Discard**, the user's explicit choice after its own in-use check;
   - **age cleanup**, under ADR-0038 §5's rules.

   They pass an explicit flag and run as internal operations under the lock they already hold.
   The lock order stays `DraftGate` → `DRAFT_LOCK`. No other caller gets the flag.
## Consequences

- D299's loss routes are closed in the one service every caller goes through: close, autosave, save, Don't Save at quit, and a recovery placed under another id. The text can be
  recovered where the user is looking. If the user doesn't recover it, it survives to the next
  launch.
- **IPC contracts change.**
  - `recover_draft` returns a target, and succeeds where it used to refuse.
  - `DraftError` needs to say which in-use reason applies.
  - `draftRecoveryOutcome` loses `gone ⇒ ¬toast`.
  - The dialog gains an action. Its wording and look follow the design rules, and a prototype
    comes first if it is questioned.
- **Moves can leave several drafts for one file:** one more for each session in which a draft was
  kept and the file edited before it was recovered. The user sees them all at the next launch.
  That is the cost of never guessing which text wins. A moved draft whose file is open is hidden
  until the file closes or the next launch (ADR-0038 §3).
- **The draft wire format gains a claim**, and `save_draft` and `delete_draft` gain an optional
  token. A draft written by an older build has no claim, so it counts as protected.
- **The merge path becomes a main path.** Bugs in it that nobody hit will now be hit, including
  D298 and D300, so their priority rises.
- The rule "only in the calling window" relies on the shadow store, which is best-effort
  (ADR-0033). If another window has not synced yet, its file can end up open twice. That is the
  residual risk ADR-0038 already accepted, not a new one.
- Every same-id draft write now reads the existing bundle's state under the draft lock. That is a
  small cost on every autosave.
