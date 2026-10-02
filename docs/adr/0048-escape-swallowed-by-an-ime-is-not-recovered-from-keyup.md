# 0048. Escape swallowed by an IME is not recovered from keyup

**Status**: Accepted (2026-10-02, user decision during the D34 device check).

## Context

During the D34 device check (D34 row of
[`docs/plans/20260912-frontend-backend-sequencing-order.md`](../plans/20260912-frontend-backend-sequencing-order.md#d34)),
a physical Esc first did nothing on a release bundle. A debug bundle of
`ef91e24` was built, and Web Inspector logged `keydown` and `keyup` on
`window`. The results:

- With the WeType pinyin IME (`com.tencent.inputmethod.wetype.pinyin`)
  active, including its internal "English" mode, the Escape `keydown` never
  reaches WKWebView. Only the `keyup` arrives.
- With the system ABC layout, both arrive, and every D34 criterion passed.
- The computer-use harness's synthesized Escape produces only a `keyup`,
  under any input source.

mdpro acts on Escape only at `keydown`: the
[ADR-0045](0045-modal-escape-goes-to-the-last-dialog-in-dom-order.md) dialog
stack, Settings, the context menus, and the CodeMirror and Milkdown keymaps.
So for a WeType user every Escape feature in mdpro does nothing.

The forces as understood at the time:

- A `keyup` fallback could recover the key. But an IME that legitimately
  consumes Escape to cancel composition also lets the `keyup` through. A
  fallback would then act a second time on the same press, dismissing a
  dialog or menu when the user only meant to cancel composition.
- ADR-0045 decision 4 already ignores Escape during IME composition
  (`isComposing`, keyCode 229) for exactly that reason. A keyup fallback
  would undo it.
- mdpro cannot see which input source is active, so a fallback cannot be
  limited to the IMEs that swallow the key.
- The failure direction is safe. A dialog that stays open discards and writes
  nothing, and every dialog has buttons.

## Decision

mdpro handles Escape on `keydown` only. There is no `keyup` fallback, and no
detection of IMEs that swallow the key. This applies to every Escape handler,
not only the ADR-0045 stack.

## Consequences

- **Cost:** WeType users cannot dismiss any dialog or menu, or leave any
  editor mode, with Esc. They must click Keep editing, Reject, Cancel or
  the like. mdpro cannot detect this, so it cannot tell them either. The
  limit is invisible until someone presses Esc and nothing happens.
- **Cost:** a device check of any Escape criterion must use the ABC input
  source and the user's physical key. A harness-injected Escape proves
  nothing, because it never produces a `keydown`. Recorded in
  `.claude/skills/gui-acceptance/SKILL.md` §9.
- **Unknown:** only WeType and ABC were tested. Apple's built-in pinyin,
  Sogou and other IMEs may behave either way.
- **Unknown:** the 2026-09-30 discovery of D34 did not record the input
  source. Whether that physical-Esc failure was also WeType cannot be
  determined after the fact.
- Escape during composition stays safe. No press is ever handled twice.
- Reversing this needs a new ADR that supersedes this one and explains how a
  `keyup` fallback tells a swallowed press from a composition cancel.

Related: [ADR-0045](0045-modal-escape-goes-to-the-last-dialog-in-dom-order.md)
(the Escape stack and its IME rule), D34 in
[`docs/plans/20260912-frontend-backend-sequencing-order.md`](../plans/20260912-frontend-backend-sequencing-order.md#d34).
