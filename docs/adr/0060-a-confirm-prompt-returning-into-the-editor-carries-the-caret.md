# 0060. A confirm prompt returning into the editor carries the caret

**Status**: Accepted (2026-10-08, decided by the user for D38). Amends
ADR-0044's D37 consequences: the caret is no longer carried "only when the
editor was focused", and the D38 cost bullet no longer holds. ADR-0044 is
otherwise unchanged.

## Context

An MCP write or insert in WYSIWYG rebuilds the editor (ADR-0044). D37 carries
focus and the caret across that rebuild, but only when `view.hasFocus()` at
capture time. An MCP confirm prompt (ADR-0042) holds focus while it is open,
so a rebuild that lands while a prompt is open records nothing:

- With two prompts queued, the first approval rebuilds the editor while the
  second prompt already holds focus. The second prompt's saved return target
  is the old editor view, which the rebuild tears down. On close the dialog
  falls back to `focusActiveMilkdownAtEnd`: the caret jumps to the end of the
  document and the next keystroke lands there (D38).
- The same happens with a single prompt that is still open when a rebuild
  lands.

D37 accepted this as a known limit, pinned by guard G-6 ("a dialog focused at
capture time: no record, no log") and G-17 ("keystrokes land at the end").
G-6's purpose was that the carry never takes focus from a dialog; its "no
record" half is what produces the jump.

Options considered: carry for any prompt that returns into this editor;
carry only when a prompt inherited focus from an earlier prompt (keeps G-6,
but a single open prompt still jumps); leave D38 as a known limit.

## Decision

1. The capture also succeeds when focus is inside an open dialog built on
   `useReturnFocusOnClose` **and** that dialog's return target is inside this
   editor. The snapshot is marked `viaDialog`.
2. On restore, a `viaDialog` carry whose prompt still holds focus does **not**
   take focus. It redirects the prompt's return target to the new editor, sets
   and scrolls the caret, and logs one `restored` entry with
   `focus: "deferred"`. When the prompt closes, focus returns to the new editor
   with the carried caret.
3. Focus held by anything else (another dialog, an input outside the editor)
   still records nothing and logs `skipped:focus-elsewhere`. The
   end-of-document fallback stays for a genuinely lost target.
4. G-6 keeps "focus stays on the prompt" and now expects the deferred
   `restored` line. G-17 now expects the caret where it was.

## Consequences

- Approving or rejecting queued prompts, or one prompt open across a rebuild,
  leaves the caret where the user was typing (mapped across the approved
  write, as for a focused carry).
- **Cost:** the qualifying set is "any dialog built on
  `useReturnFocusOnClose`", not "the MCP confirm prompt". Today they are the
  same. A future dialog that adopts the hook joins the carry without a
  decision; narrowing it then needs a new ADR.
- **Cost:** the restore now writes into a dialog's focus-return list from
  outside the dialog (`redirectReturnFocus`). Two modules share that state.
- **Cost:** if the restore throws after the redirect, the prompt closes onto
  the new editor with its default caret (logged `skipped:error`), not onto
  the end fallback.
- Source mode is unaffected; the carry is WYSIWYG-only. The time-out,
  withdrawn and cancelled closes use the same unmount path but are not
  separately tested.

Related: ADR-0042 (confirm prompts), ADR-0044 (wholesale replace and the D37
carry), D37 and D38 in
`docs/plans/20260912-frontend-backend-sequencing-order.md`.
