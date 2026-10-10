# Device drag driver (`drag.sh`, D113)

A small CLI that performs a **real** mouse drag inside mdpro's editor on the Mac
mini, for GUI device checks of drag-and-drop paths (D90, D94, D102, D103).

## What it fixes

computer-use drags with `left_mouse_down` → `mouse_move` → `left_mouse_up`.
The moves are posted as plain *mouse-moved* events, not
`kCGEventLeftMouseDragged`, so WebKit never opens a drag session: no
`dragstart` fires and the editor just re-selects text. The drop path is never
reached, so those items could only be recorded as NOT EXERCISED.

`drag.sh` posts `leftMouseDown`, then N × `leftMouseDragged`, then
`leftMouseUp` as CGEvents on the HID event tap. That is the event sequence
WebKit needs to start a drag.

```
drag.sh x1 y1 x2 y2 [--copy] [--steps N] [--hold-ms MS] [--step-ms MS] [--settle-ms MS]
drag.sh install
```

Files: `scripts/device/dragPlan.mjs` (pure planner), `drag.mjs` (CLI),
`drag.swift` (executor), `drag.sh` (wrapper).

## Install (harness, over ssh — never during a device run)

1. rsync `scripts/device/` to the mini's `~/.mdpro-redesign/dtrack/tools/device/`.
2. Over ssh, run `~/.mdpro-redesign/dtrack/tools/device/drag.sh install`. It
   compiles `drag.swift` with `swiftc -O` into
   `~/.mdpro-redesign/dtrack/tools/drag-bin` (override the directory with
   `MDPRO_DRAG_BIN_DIR`) and prints
   `drag: installed <BIN> sha256 <hex>`.
3. The device brief names that binary path and its sha256.

Only `install` compiles. On a drag, if `drag-bin` is missing or older than
`drag.swift`, `drag.sh` exits **3** before running anything:
`drag: executor missing or stale at <BIN>; run 'drag.sh install' first (not during a device run)`.
The tester reports that and does not compile.

## Who holds the Accessibility grant

Posting HID events needs Accessibility permission. **dtrack's terminal app
holds the grant**, and `drag-bin` inherits it as a child process of that
terminal. So `drag.sh` must run from dtrack's own terminal. It cannot run over
ssh, because an ssh session has no grant.

If `AXIsProcessTrusted()` is false, `drag-bin` prints
`drag: this process lacks Accessibility permission; …` and exits **2**. The run
is then reported **BLOCKED**. The tester does not attempt a workaround (no
granting from inside the run, no switching to another terminal or tool).

## Coordinates

Global display points, with the origin at the top-left of the main display.
These are the same coordinates computer-use and `screencapture` use on a 1x
display. The Mac mini runs 1920×1080 at scale 1, so screenshot pixels are
points. On a Retina display, divide screenshot pixels by the scale that
`drag.sh` prints:

```
drag: scale 1 points (412,318)->(640,455) steps 20 copy false
```

## How to aim

1. Select the text (or put the caret on the node) to drag, then take a screenshot.
2. Read the coordinates of the **middle of the selection** (the start point)
   and of the drop point.
3. Run `drag.sh x1 y1 x2 y2`. A drag shorter than 5 points is refused, because
   WebKit would treat it as a click.

## Move vs `--copy`

- Without `--copy`: a move-drop. The source is removed and inserted at the drop point.
- `--copy`: holds ⌥ (Option) for the whole drag (Option key down first, the
  alternate flag on every mouse event, Option key up last), so the drop is a
  copy-drop and the source stays.

## Tuning flags

| Flag | Default | Range | Meaning |
|---|---|---|---|
| `--steps N` | 20 | 2–200 | number of `leftMouseDragged` events |
| `--hold-ms` | 150 | 0–2000 | pause after mouse-down, before the first drag event |
| `--step-ms` | 16 | 0–2000 | pause after each drag event |
| `--settle-ms` | 100 | 0–2000 | pause before mouse-up |

If no `dragstart` happens, raise `--hold-ms` first (to 300–500). If the drop
lands in the wrong place, raise `--settle-ms`.

## What proves a drop happened

The scale line only says events were posted. Proof of a drop is **both**:

- the drop's log line in `~/.mdpro/mdpro.log` (e.g. `editor.table.drop`) for
  this run, and
- the matching store / document change.

A run that prints the scale line but produces no drop log is recorded as
**not exercised**, not as passed.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | plan posted |
| 1 | malformed plan JSON (executor) |
| 2 | no Accessibility permission. Report BLOCKED |
| 3 | executor missing or stale. Run `drag.sh install` (harness, not tester) |
| 64 | bad arguments (message `drag: <error>` plus usage). Nothing was posted |
