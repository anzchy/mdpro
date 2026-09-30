# ADR-0042 WI-10 — MCP write confirmation in the owning window: GUI acceptance (2026-09-30)

This is the real-device acceptance for
[ADR-0042](../adr/0042-mcp-write-confirmation-is-an-in-window-queued-prompt.md)
(work items WI-1…WI-9, last commit `6df4896`). The confirmation crosses the
Tauri effects boundary (`emit_to` a window, `mcp_confirm_reply` back) and the
native window lifecycle. That boundary has no automated real-path test, because
the Tauri `test` feature is not enabled. This run is the only real-path check.

The evidence is:

- MCP client responses (HTTP status, error code, elapsed time);
- log slices from `~/.mdpro/mdpro.log`;
- zoomed captures of the two windows.

No screenshots were kept. The MCP token was never read.

## Binary under test

| Field | Value |
|---|---|
| Bundle | `src-tauri/target/debug/bundle/macos/mdpro.app` (debug build). `/Applications/mdpro.app` was not used |
| `Contents/MacOS/tauri-app` | mtime 2026-09-30T06:48:39Z, sha256 `4f808098586efa1b3e3c324baeb1c0ebbd5225396017a04d4b7cacf151bd461d` |
| `Contents/MacOS/mdpro_mcp` | sha256 `1c0de0830989fd2f3ce8ac4a78c37eb6306f0e5c9828d6a78a7fb56a5b34c8cf` |
| Freshness | The binary is newer than every source changed by WI-5…WI-9 (`52714d9`, `9bec8ed`, `a24256f`, `3a78ed1`, `6df4896`; the last was committed 06:46:21Z) |
| Cold launch | Launched with no mdpro process running. It logged `appReady:false`. The native `rfd` alert that the old build showed no longer exists in this image, so each in-window prompt below came from this build |

## Method

- **Driver:** an MCP stdio client spawning the bundled `mdpro_mcp` sidecar, which
  reads the port and token itself. Each call recorded its HTTP status, error
  code and elapsed time.
- **Windows:** two windows:
  - **alpha** is window `main`;
  - **beta** is a second window.
  Each held one fixture document.
- **Focus control:** writes were issued with the target's owning window
  focused, with the other window focused, or with mdpro in the background.
- **Fixtures:** plain Markdown files in the session scratchpad, not in the
  repo: a short heading and one body line per window.
- **Settings / quit / close:** Settings through ⌘, → Integrations. Quit through
  AppleScript `quit`, the same Apple Event as the Dock's Quit. Window close
  through the window's close button.

## Verdicts

| # | Criterion | Result |
|---|---|---|
| G1 replace | Background write → prompt only in the owning window; Approve applies | **pass**. The prompt appeared only in the owning window, and beta showed none. The card follows the rule-32 pattern and **Reject** had initial focus. Approve applied the write, and the client got success after 31.2 s |
| G1 insert | Reject → 403; owning window focused → no prompt | **pass**. Reject → `403 USER_REJECTED` at 2.3 s and 3.6 s. With the owning window focused, the insert applied with no prompt (0.0 s) |
| G1 table | Table actions go through the same prompt | **NOT VERIFIED on device**. Table actions are HTTP-only and not exposed as MCP tools, so the driver could not reach them. They are covered only by the source-level test SG-1(ix) |
| G1 Dock | Dock bounce when a prompt arrives unfocused | **NOT VERIFIED**. The Dock was not observable to the GUI harness, and access to it was not granted |
| G2 | A write to a document in beta while alpha is focused prompts in beta | **pass**. Only beta showed the prompt, and the log line's `windowLabel` is beta's |
| G3 | MCP off in Settings with a prompt pending → 503, prompt closes | **pass**. ⌘, opened Settings while the prompt was up. The client got `503 CONFIRM_CANCELLED` in 1.7 s, the prompt closed, and the content was unchanged. MCP was turned back on afterwards |
| G4 | Quit with a prompt pending → the app quits (no `-128`) | **pass**. `osascript` returned rc=0; the old app-modal `rfd` alert made it return `-128`. The client got `503 CONFIRM_CANCELLED` at 3.1 s. The log order was `app.quit` → `mcp.confirm` cancelled → `mcp.http_server.stop` |
| G5 | Closing the owning window with a prompt pending → 503 | **pass**. The window was clean. The client got 503 at 2.2 s. The cancellation was logged only after the close was allowed: `allowed_close`, then `cancelled` 2 ms later |
| G5b | A close that the user aborts does not cancel the request | **pass**. CloseRequested on a **dirty** owning window showed the Unsaved-changes prompt, and **Keep editing** was chosen. The MCP request was not cancelled and ran to `408` at 60 s |
| G6 | 60 s unanswered → 408 | **pass**. `408 CONFIRM_TIMEOUT` at 60.0 s, `waitedMs` ≈ 60000, outcome `timedOut`. Observed several times |
| G7 | Two quick writes to one window → FIFO, one approval per write | **pass**. `queueDepth` went 1 → 2. The first write was approved and applied. The second was shown only after that, and was rejected (403 at 5.1 s) |
| G8 | Logs carry no title, path, content or token | **pass**. There were 56 `mcp.confirm*` / `ui.mcp_confirm*` lines that day. Their context keys are only `documentId`, `operation`, `queueDepth`, `requestId`, `windowLabel`, `outcome`, `waitedMs`, `verdict` and `approved` (bool) |

## Defects found on the way (both predate ADR-0042)

Neither defect is a failure of ADR-0042. Both are in code that WI-1…WI-9 did
not change.

### D34 — Escape does not dismiss modal dialogs in the real app

Recorded as [D34](../plans/20260912-frontend-backend-sequencing-order.md#d34).

**Reproduction:**

1. Make a document dirty.
2. Close its window, so that the older `ConfirmDialog` ("Unsaved changes")
   appears.
3. Press the **physical** Esc key (the user did this). The dialog stays up,
   and no `ui.dialog.cancel` is logged.

The same happens on `McpWriteConfirmDialog` with a harness-injected Escape (4
times). The jsdom tests pass.

**Where:**

- `src/components/common/ConfirmDialog.tsx` and
  `src/components/common/McpWriteConfirmDialog.tsx` both handle Escape only
  through a card-level `onKeyDown`, and rely on `autoFocus` to put focus inside
  the card.
- The root cause is not confirmed. The leading hypothesis is that focus is not
  inside the card in WKWebView.

**Impact:** a usability defect. The failure direction is safe: nothing is
discarded or applied.

### D35 — `insert_content` in WYSIWYG does not reach Milkdown

Recorded as [D35](../plans/20260912-frontend-backend-sequencing-order.md#d35).

**Reproduction:**

1. Open the target document as the active document, in WYSIWYG.
2. Send `insert_content` and let it apply (owning window focused, or the
   prompt approved). The client gets success, and the shadow store holds the
   inserted text.
3. The tab gains a dirty dot, but Milkdown never shows the text. No
   `editor.milkdown.reload` is logged.

**Where:** `handleInsertContent` in `src/hooks/useMcpEvents.ts` (~L229-286)
updates the store and CodeMirror only. It never calls `prepareWholesaleReplace`,
unlike `handleWriteDocument` (~L207). Milkdown reads its content once, as
`defaultValueCtx`, and rebuilds only when `editorGenerations[id]` is bumped.

**Possible data loss (inferred from code, not reproduced):** the next WYSIWYG
edit's `write()` in `src/plugins/milkdown/editSync/controller.ts` (~L141-164)
serializes the stale Milkdown document and writes it over the store, which
would drop the insert.

**History:** the handler dates from `28ab12d` and was last touched in
`b7dbbfc`. WI-9 changed only the Rust gate in front of it.

## Notes

- **Unintended timeouts.** The harness's turn latency was about 60 s, the same
  as the confirmation budget. Several prompts timed out (`408`) before the
  answering click landed. These were harness timing, not defects. The
  remedy is to put the trigger, the answer and the evidence capture in one
  step (see `progress.md`).
- **`osascript` keystrokes are not an Escape test.** System Events keystrokes
  went to the frontmost app, which was the terminal (Warp), not mdpro. They are
  not evidence for or against D34. The physical keypress is the evidence.
- G1 table and the Dock bounce stay open as NOT VERIFIED. They are not passes.
