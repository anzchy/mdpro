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
The Mac mini runs 1920×1080 at scale 1, so a full-resolution `screencapture`
pixel is one point. **Don't read coordinates off a computer-use screenshot**:
the tool may downscale the image it returns, and then its pixels are not
points. On a Retina display, also divide `screencapture` pixels by the scale
that `drag.sh` prints:

```
drag: scale 1 points (412,318)->(640,455) steps 20 copy false
```

## How to aim

1. Select the text (or put the caret on the node) to drag, then take a screenshot.
2. Hover each point with computer-use `mouse_move`, first the **middle of the
   selection** (the start point), then the drop point. After each hover, read
   the real cursor position in global points:

   ```sh
   osascript -l JavaScript -e 'ObjC.import("AppKit"); var p=$.NSEvent.mouseLocation; var h=$.NSScreen.screens.objectAtIndex(0).frame.size.height; Math.round(p.x)+" "+Math.round(h-p.y)'
   ```

   It prints `x y`, top-left origin, the space `drag.sh` takes. It works
   whatever scale the screenshot was taken at.
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

**30 s cap (D133).** The whole drag, `hold-ms + steps × step-ms + settle-ms`,
may last at most **30 000 ms**. Exactly 30 000 runs; 30 001 is refused with
exit 64 before anything is posted, and the message names the cap and the total:
`drag: plan duration 400250 ms exceeds the 30000 ms cap (…)` for
`--steps 200 --step-ms 2000`. Each flag's own range still applies, but not every
combination fits under the cap. The cap keeps every drag well inside the 120 s
Claude Code Bash timeout, which would otherwise kill the executor mid-drag.
`drag.swift` enforces the same cap on the plan it reads.

## If a run is interrupted

The executor tracks what it holds (the mouse button and ⌥). On every exit
path, it posts the matching mouse-up at the last point and the Option key-up
before it exits:

- an internal error (`could not create … event`, exit 1);
- SIGINT (Ctrl-C, exit 130), SIGTERM (e.g. a tool timeout, exit 143) and SIGHUP
  (the terminal closed, exit 129).

It also refuses, before posting anything (exit 1), a plan where any press lacks
a later matching release (`down`→`up`, `altDown`→`altUp`, nested as
`altDown`, `down`, `up`, `altUp`), or whose waits sum past the cap.

**Remaining risk: SIGKILL (`kill -9`, or a crash) cannot be caught.** The
button or ⌥ can then stay held. If the cursor drags or selects on its own, or
every click acts as an ⌥-click, release them by hand. Click once and release on
an empty part of the desktop, then press and release ⌥ once. Note it in the
report, because events the app saw after the kill are not part of the run.

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
| 1 | malformed plan (executor): bad JSON, a press without a later matching release, waits over 30 000 ms, or an event it could not create (anything held was released first) |
| 2 | no Accessibility permission. Report BLOCKED |
| 3 | executor missing or stale. Run `drag.sh install` (harness, not tester) |
| 64 | bad arguments, including a plan over the 30 s cap (message `drag: <error>` plus usage). Nothing was posted |
| 129 / 130 / 143 | interrupted by SIGHUP / SIGINT / SIGTERM. The button and ⌥ were released first; the drop is not proof of anything |
