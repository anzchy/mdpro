// Purpose: The executor half of the device drag driver (D113). Reads the JSON
// drag plan that `drag.mjs` prints and posts it as real CGEvents to the HID
// event tap, so WebKit sees leftMouseDragged and starts a drag session.
//
// Pipeline: stdin JSON (dragPlan.mjs `buildDragPlan`) → validate → Accessibility
// check → signal handlers → one summary line on stdout → post each event in order.
//
// Key decisions:
// - Only three mouse types are ever posted: leftMouseDown, leftMouseDragged,
//   leftMouseUp. No plain move: that is what made computer-use drags re-select
//   text instead of dragging it.
// - The whole plan is validated before anything is posted (exit 1): every press
//   has a later matching release, nested altDown, down, up, altUp, and the waits
//   sum to at most `maxPlanMs` (= dragPlan.mjs `MAX_PLAN_MS`, D133).
// - D133: `held` tracks the button, ⌥ and last point while posting. fail() and
//   the SIGINT / SIGTERM / SIGHUP handlers post the matching up and Option
//   key-up before exiting; `lock` stops a release mid-post and any post after
//   it. SIGKILL cannot be caught: the guide keeps the manual release steps.
// - Option is held with the Option key (virtual key 58) and the alternate flag
//   on every mouse event while `alt` is true, giving a copy-drop.
// - Coordinates are global display points, top-left origin of the main display.
//
// Exit codes: 0 posted, 1 malformed plan, 2 no Accessibility permission,
// 129 / 130 / 143 interrupted by SIGHUP / SIGINT / SIGTERM (after releasing).
// Compiled only by `drag.sh install`; never during a device run.
import AppKit
import ApplicationServices
import CoreGraphics
import Foundation

struct DragEvent: Decodable { let type: String; let x, y: Double?; let ms: Int?; let alt: Bool? }

/// Upper bound on the sum of every wait in one plan; equals dragPlan.mjs `MAX_PLAN_MS`.
let maxPlanMs = 30_000
/// What the posting loop holds right now. Read and written only under `lock`.
var held = (button: false, alt: false, at: CGPoint.zero)
let lock = NSRecursiveLock()
let source = CGEventSource(stateID: .hidSystemState)

func fmt(_ v: Double) -> String { v == v.rounded() ? String(Int(v)) : String(v) }
let mouseTypes: [String: CGEventType] = ["down": .leftMouseDown, "dragged": .leftMouseDragged, "up": .leftMouseUp]

let input = FileHandle.standardInput.readDataToEndOfFile()
guard let plan = try? JSONDecoder().decode([DragEvent].self, from: input), !plan.isEmpty else {
    fail("drag: malformed plan JSON on stdin", 1)
}

var totalMs = 0
var pressed = (button: false, alt: false)
for event in plan {
    var inOrder = true
    switch event.type {
    case "down", "dragged", "up":
        guard let x = event.x, let y = event.y, x.isFinite, y.isFinite else {
            fail("drag: malformed plan: \(event.type) without a finite x and y", 1)
        }
        inOrder = event.type == "down" ? !pressed.button : pressed.button
        if event.type != "dragged" { pressed.button = event.type == "down" }
    case "wait":
        guard let ms = event.ms, ms >= 0 else { fail("drag: malformed plan: wait without ms", 1) }
        guard ms <= maxPlanMs, totalMs + ms <= maxPlanMs else { fail("drag: malformed plan: waits exceed the \(maxPlanMs) ms cap", 1) }
        totalMs += ms
    case "altDown", "altUp":
        inOrder = !pressed.button && pressed.alt == (event.type == "altUp")
        pressed.alt = event.type == "altDown"
    default:
        fail("drag: malformed plan: unknown event type \(event.type)", 1)
    }
    guard inOrder else { fail("drag: malformed plan: \(event.type) out of order (unpaired or misnested press)", 1) }
}
guard !pressed.button, !pressed.alt else { fail("drag: malformed plan: a press has no matching release", 1) }

guard let start = plan.first(where: { $0.type == "down" }), let end = plan.last(where: { $0.type == "up" }),
      let x1 = start.x, let y1 = start.y, let x2 = end.x, let y2 = end.y
else {
    fail("drag: malformed plan: needs a down and an up event", 1)
}

/// Posts leftMouseUp at the last point and Option key-up for what is held (after the validator: nothing above posts).
func releaseHeld() {
    lock.lock()
    if held.button, let up = CGEvent(mouseEventSource: source, mouseType: .leftMouseUp,
                                     mouseCursorPosition: held.at, mouseButton: .left) {
        up.setIntegerValueField(.mouseEventClickState, value: 1)
        if held.alt { up.flags = .maskAlternate }
        up.post(tap: .cghidEventTap)
    }
    if held.alt { CGEvent(keyboardEventSource: source, virtualKey: 58, keyDown: false)?.post(tap: .cghidEventTap) }
    held = (false, false, held.at)
}

/// Releases anything held, reports, and exits. Keeps `lock`, so nothing posts after.
func fail(_ message: String, _ code: Int32) -> Never {
    lock.lock()
    releaseHeld()
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(code)
}

guard AXIsProcessTrusted() else {
    let message = "drag: this process lacks Accessibility permission; run it from a terminal that has it (System Settings → Privacy & Security → Accessibility)"
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(2)
}

let signalQueue = DispatchQueue(label: "drag.signals")
let signalSources = [SIGINT, SIGTERM, SIGHUP].map { sig -> DispatchSourceSignal in
    signal(sig, SIG_IGN)
    let src = DispatchSource.makeSignalSource(signal: sig, queue: signalQueue)
    src.setEventHandler { lock.lock(); releaseHeld(); exit(128 + sig) }
    src.resume()
    return src
}

let steps = plan.filter { $0.type == "dragged" }.count
let copy = plan.contains { $0.type == "altDown" }
let scale = Double(NSScreen.main?.backingScaleFactor ?? 1)
print("drag: scale \(fmt(scale)) points (\(fmt(x1)),\(fmt(y1)))->(\(fmt(x2)),\(fmt(y2))) steps \(steps) copy \(copy)")
fflush(stdout)

for event in plan {
    lock.lock()
    switch event.type {
    case "down", "dragged", "up":
        guard let type = mouseTypes[event.type], let x = event.x, let y = event.y,
              let cg = CGEvent(mouseEventSource: source, mouseType: type,
                               mouseCursorPosition: CGPoint(x: x, y: y), mouseButton: .left)
        else { fail("drag: could not create a \(event.type) event", 1) }
        if event.type != "dragged" { cg.setIntegerValueField(.mouseEventClickState, value: 1) }
        if event.alt == true { cg.flags = .maskAlternate }
        cg.post(tap: .cghidEventTap)
        held.button = event.type != "up"
        held.at = CGPoint(x: x, y: y)
    case "altDown", "altUp":
        let down = event.type == "altDown"
        guard let cg = CGEvent(keyboardEventSource: source, virtualKey: 58, keyDown: down) else { fail("drag: could not create an Option key event", 1) }
        cg.flags = down ? .maskAlternate : []
        cg.post(tap: .cghidEventTap)
        held.alt = down
    default: break
    }
    lock.unlock()
    // Bounded by the validator (≤ maxPlanMs), so the useconds_t product cannot overflow.
    if event.type == "wait" { usleep(useconds_t(event.ms ?? 0) * 1000) }
}
