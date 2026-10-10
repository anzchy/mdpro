# 0061. A prompt that opens after the capture also carries the caret

**Status**: Accepted (2026-10-08). Proposed 2026-10-08 after the D38 device failure. Amends ADR-0060
decisions 2 and 3. ADR-0060 is otherwise unchanged.

## Context

ADR-0060 defers the restore to a prompt only when the carry was captured
*through* that prompt (`viaDialog`): focus was already inside a queued MCP
confirm prompt when the write landed. Its jsdom tests delivered both
`mcp:confirm_request` events before the first Approve.

The Mac mini run on `f78990d` (both D38 variants) failed with
`editor.milkdown.focus.restore` `skipped:focus-elsewhere` for r1's write,
then `ui.mcp_confirm.focus_return` `fallback` at the last close, and the
next keystroke went to the end of the document. Real Rust shows one prompt
at a time per window (`mcp_confirm/queue.rs`) and on a reply wakes the
approved writer under the lock (`outbox.rs`, `Effect::Resolve`) before the
next prompt is drained (`broker.rs`). The frontend closes prompt 1 before it
replies (`useMcpConfirm.ts` `answer()`), and prompt 1's close returns focus
to the editor. So r1's write reaches the webview **before** prompt 2 exists:

1. The capture sees the editor focused and arms a plain record (no
   `viaDialog`).
2. Prompt 2 renders and saves the old editor view as its return target, or
   nothing if the rebuild already moved focus to `<body>`.
3. The rebuild removes the old view and prompt 2 takes focus.
4. The restore finds focus in a prompt that the record was not captured
   through, and skips. Prompt 2 then closes onto a target that no longer
   exists.

Reordering Rust (drain before waking the writer) would not close it: a
Tauri event renders non-urgently, so the insert listener can still run
before prompt 2 commits.

## Decision

1. The snapshot also keeps the old editor's DOM element (`oldDom`).
2. On restore, a carry also defers to the prompt holding focus when that
   prompt would otherwise return into nothing: none of its saved targets is
   still connected, and its targets are either empty or include `oldDom`
   (`wouldReturnIntoGone`). The deferral is the same as ADR-0060 decision 2:
   redirect, set and scroll the caret, do not focus, log `restored` with
   `focus: "deferred"`.
3. A prompt whose saved target is still connected (for example one opened
   from an input outside the editor) is still left alone and logs
   `skipped:focus-elsewhere`. That is ADR-0060 decision 3, now scoped to it.
4. The `skipped:focus-elsewhere` and deferred lines carry two category-only
   fields, `active` and `promptTarget`, so a device log shows which case it
   was. They never carry content.

## Consequences

- Queued prompts approved or rejected in a window that was in the
  background leave the caret where the user was typing, whichever arrives
  first, the write or the next prompt.
- **Cost:** a prompt that opened for an unrelated reason and lost its own
  target to the rebuild now closes onto the editor caret rather than the
  end-of-document fallback. Today the MCP confirm prompt is the only
  adopter of `useReturnFocusOnClose`, so the two are the same. A future
  adopter inherits this without a decision.
- **Cost:** the snapshot holds a reference to a detached DOM subtree until
  the record is consumed or expires (at most the 10 s TTL).
- **Cost:** the jsdom tests model the orderings that Rust and React can
  produce, not WKWebView focus itself (autoFocus while the window is
  inactive, buttons that do not take focus on click). The new log fields
  exist because the next device run is the only check of those.

Related: ADR-0060, ADR-0042, ADR-0044, D38 in
`docs/plans/20260912-frontend-backend-sequencing-order.md`.
