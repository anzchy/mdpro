// Purpose: The executor half of the device drag driver (D113). Reads the JSON
// drag plan that `drag.mjs` prints and posts it as real CGEvents to the HID
// event tap, so WebKit sees leftMouseDragged and starts a drag session.
//
// Pipeline: stdin JSON (dragPlan.mjs `buildDragPlan`) → validate → Accessibility
// check → one summary line on stdout → post each event in order.
//
// Key decisions:
// - Only three mouse types are ever posted: leftMouseDown, leftMouseDragged,
//   leftMouseUp. No plain move: that is what made computer-use drags re-select
//   text instead of dragging it.
// - The whole plan is validated before anything is posted, so malformed input
//   (exit 1) never leaves the button held down.
// - Option is held with the Option key (virtual key 58) and the alternate flag
//   on every mouse event while `alt` is true, giving a copy-drop.
// - Coordinates are global display points, top-left origin of the main display.
//
// Exit codes: 0 posted, 1 malformed plan, 2 no Accessibility permission.
// Compiled only by `drag.sh install`; never during a device run.
import AppKit
import ApplicationServices
import CoreGraphics
import Foundation

struct DragEvent: Decodable {
    let type: String
    let x: Double?
    let y: Double?
    let ms: Int?
    let alt: Bool?
}

func fail(_ message: String, _ code: Int32) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(code)
}

func fmt(_ v: Double) -> String {
    v == v.rounded() ? String(Int(v)) : String(v)
}

let mouseTypes: [String: CGEventType] = [
    "down": .leftMouseDown,
    "dragged": .leftMouseDragged,
    "up": .leftMouseUp,
]

let input = FileHandle.standardInput.readDataToEndOfFile()
guard let plan = try? JSONDecoder().decode([DragEvent].self, from: input), !plan.isEmpty else {
    fail("drag: malformed plan JSON on stdin", 1)
}

for event in plan {
    switch event.type {
    case "down", "dragged", "up":
        guard let x = event.x, let y = event.y, x.isFinite, y.isFinite else {
            fail("drag: malformed plan: \(event.type) without a finite x and y", 1)
        }
    case "wait":
        guard let ms = event.ms, ms >= 0 else { fail("drag: malformed plan: wait without ms", 1) }
    case "altDown", "altUp":
        break
    default:
        fail("drag: malformed plan: unknown event type \(event.type)", 1)
    }
}

guard let start = plan.first(where: { $0.type == "down" }), let end = plan.last(where: { $0.type == "up" }),
      let x1 = start.x, let y1 = start.y, let x2 = end.x, let y2 = end.y
else {
    fail("drag: malformed plan: needs a down and an up event", 1)
}

guard AXIsProcessTrusted() else {
    let message = "drag: this process lacks Accessibility permission; run it from a terminal that has it (System Settings → Privacy & Security → Accessibility)"
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(2)
}

let steps = plan.filter { $0.type == "dragged" }.count
let copy = plan.contains { $0.type == "altDown" }
let scale = Double(NSScreen.main?.backingScaleFactor ?? 1)
print("drag: scale \(fmt(scale)) points (\(fmt(x1)),\(fmt(y1)))->(\(fmt(x2)),\(fmt(y2))) steps \(steps) copy \(copy)")
fflush(stdout)

let source = CGEventSource(stateID: .hidSystemState)
for event in plan {
    switch event.type {
    case "down", "dragged", "up":
        guard let type = mouseTypes[event.type], let x = event.x, let y = event.y,
              let cg = CGEvent(mouseEventSource: source, mouseType: type,
                               mouseCursorPosition: CGPoint(x: x, y: y), mouseButton: .left)
        else { fail("drag: could not create a \(event.type) event", 1) }
        if event.type != "dragged" { cg.setIntegerValueField(.mouseEventClickState, value: 1) }
        if event.alt == true { cg.flags = .maskAlternate }
        cg.post(tap: .cghidEventTap)
    case "altDown", "altUp":
        let down = event.type == "altDown"
        guard let cg = CGEvent(keyboardEventSource: source, virtualKey: 58, keyDown: down) else {
            fail("drag: could not create an Option key event", 1)
        }
        cg.flags = down ? .maskAlternate : []
        cg.post(tap: .cghidEventTap)
    case "wait":
        usleep(useconds_t((event.ms ?? 0) * 1000))
    default:
        break
    }
}
