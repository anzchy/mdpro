# 0075. 0.3.1 ships without in-editor drag and drop

**Status**: Accepted (2026-10-11). User's words: 「A：保持现状并记录
(Recommended)」.

## Context

The D90 / D94 / D103 fixes guard what happens when a dragged slice that
carries a table is dropped inside a table. All three pass in unit tests
(jsdom, `tests/support/tableDropDriver.ts`) and none could be reached on a
device: computer-use on `8994bc8` and the D113 CGEvent driver on `8c996b1`
both left the selection untouched, with no `drop` event, no log line and no
store change ([D113 record](../test/20261011-drag-8c996b1-device-check.md)).

adr047-verify split the gesture in two on the Mac mini, and an in-editor drag
turns out to fail at two layers.

**Layer 1: a trackpad press usually never starts a drag session.** WebKit
decides between a text drag and a selection extension on the first
`mouseDragged` after the press. If that event arrives inside its Mac
text-drag delay (about 150 ms), the gesture is a selection for good, however
long the pointer is then held still. A trackpad press emits a sub-point
`mouseDragged` as the finger lands, so it takes the selection path. Three
hand-built CGEvent plans on the mini reproduce this (press and hold still:
drag pasteboard `changeCount` advances; press with a 1 pt move at 30 ms, then
hold still 500 ms: no drag, selection re-made; the same move at 200 ms:
drag), and the user confirmed it on the MacBook `c57a1dd` build: a trackpad
press-hold-drag re-selects with no drag image, a mouse press shows the drag
image. This is WebKit's own behaviour, not mdpro's; mdpro sets no
`-webkit-user-drag`, `draggable` or `dragstart` handler on the editor.

**Layer 2: when a session does start, the drop is swallowed.** After a
`drag.sh` gesture (perfectly still press), `NSPasteboard(name: .drag)` holds
WebKit HTML whose text is exactly the selection, which only a drag session
started by WebKit writes. The user saw the same on the MacBook `c57a1dd`
build: a mouse drag shows the drag image, and releasing it over another
paragraph of the same document leaves the text where it was (「没有，松开后文
字原地不动」). The **drop** never arrives, and it is swallowed by
construction:

- `src-tauri/tauri.conf.json:21` sets `dragDropEnabled: true`.
- wry 0.53.5 `src/wkwebview/drag_drop.rs` forwards `draggingEntered`,
  `draggingUpdated` and `performDragOperation` to WKWebView's own
  implementation only when the handler returns `false`.
- tauri-runtime-wry 2.9.3 `src/lib.rs:4634-4664` sends the event to Tauri and
  then returns `true` unconditionally, whether or not the drag carries file
  paths.

So on macOS WebKit never receives an in-page drop, ProseMirror never fires
`drop`, and `handleDrop` in `pasteTableNormalize.ts` is unreachable in the
shipped app. The same holds for every shipped build back to the first Tauri
one. wry 0.57.0 and tauri-runtime-wry 2.11.4 / 2.12.1 behave the same, so
WI-004 (the Tauri upgrade) does not change it. Registered as
[D134](../plans/20260912-frontend-backend-sequencing-order.md#d134).

Three options were put to the user:

- **A.** Keep the behaviour and record it. No in-editor drag of text or
  tables; the guards stay as defence; file drops keep working.
- **B.** Set `dragDropEnabled: false` and handle drops in the webview.
  In-page drag works, but Tauri stops supplying file paths, and both opening
  a dropped `.md` and inserting an image by path (`src/App.tsx:621-664`)
  depend on them.
- **C.** A `[patch.crates-io]` fork of tauri-runtime-wry that returns `false`
  when `paths` is empty. File drops still reach Tauri; in-page drags fall
  through to WebKit. A small diff, carried through every Tauri upgrade.

## Decision

0.3.1 takes **A**.

- In-editor drag and drop of text and tables is not a 0.3.1 feature. It is
  recorded as absent in the feature ledger, and the release notes do not
  claim it.
- The D90 / D94 / D103 / D102 drop guards stay in the code and in the unit
  lane. Their device rows read **unreachable (Tauri intercepts drops)**, not
  NOT EXERCISED and not FAIL, and the 0.3.1 gate no longer waits on them.
- D113's driver is accepted on the pasteboard evidence and the desktop
  cursor control; no driver change is needed for this.
- B versus C is decided after 0.3.1 ships, in a new ADR that supersedes this
  one's "absent" claim. That ADR must also say what it does about layer 1:
  B or C alone makes drags work for a still press (a mouse, or the CGEvent
  driver), not for the trackpad gesture most users make.

## Consequences

- Users cannot move or copy selected text by dragging inside the editor.
  They could never do so in a shipped mdpro, so nothing regresses, but the
  gap stays unannounced to anyone who does not read the ledger.
- Three BLOCK items (D90, D94, D103 drop path) and D102 leave the 0.3.1 gate
  without device evidence that their guards fire. If a later change makes
  drops reachable (B or C), those guards must be device-checked then, with
  the drag batch brief re-run on that build.
- The drag device tooling (D113, D133) is kept and maintained even though no
  0.3.1 check uses it; its first real use is the B-or-C build. Its still
  press is the best case, not the typical one: a B-or-C device check also
  needs a plan with an early 1 pt move to stand for the trackpad.
- Picking A now means the B-or-C work cannot start as a 0.3.1 blocker. If
  C is chosen later, the fork cost lands on WI-004 as well.
