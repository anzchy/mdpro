/**
 * Purpose: The pure planner behind the device drag driver (D113): turns
 * `drag.sh x1 y1 x2 y2 [--copy] [--steps N] ...` into the ordered list of
 * mouse / modifier / wait events `drag.swift` posts as real CGEvents.
 *
 * Pipeline: argv → `parseDragArgs` (validated opts, never throws) →
 *   `buildDragPlan` (event array) → `drag.mjs` prints JSON → `drag.swift`
 *   posts it to the HID event tap.
 *
 * Key decisions:
 * - The plan never contains a plain mouse move. WebKit only starts a drag
 *   session on `leftMouseDragged` events; computer-use's mouse-moved events
 *   merely extend the text selection, which is the defect this tool fixes.
 * - A drag shorter than 5 points is refused: WebKit's drag hysteresis would
 *   turn it into a click and the run would prove nothing.
 * - `--copy` holds Option for the whole drag: `altDown` first, `altUp` last,
 *   and `alt: true` stamped on every mouse event, so the drop is a copy-drop.
 * - Intermediate points are linearly interpolated and rounded to 0.01; the
 *   last dragged point is set to the end point exactly, not a rounding of it.
 *
 * @module scripts/device/dragPlan
 * @coordinates-with scripts/device/drag.mjs (CLI that prints the plan)
 * @coordinates-with scripts/device/drag.swift (executor that posts it)
 */

/**
 * @typedef {{ x1: number, y1: number, x2: number, y2: number, copy: boolean,
 *   steps: number, holdMs: number, stepMs: number, settleMs: number }} DragOpts
 * @typedef {{ type: "altDown" | "altUp" | "down" | "dragged" | "up" | "wait",
 *   x?: number, y?: number, ms?: number, alt?: boolean }} DragEvent
 */

export const MIN_DRAG_POINTS = 5;
const COORD_RE = /^\d+(\.\d+)?$/;
const INT_RE = /^\d+$/;

/** Integer-valued flags: name → [opts key, min, max]. */
const INT_FLAGS = {
  "--steps": ["steps", 2, 200],
  "--hold-ms": ["holdMs", 0, 2000],
  "--step-ms": ["stepMs", 0, 2000],
  "--settle-ms": ["settleMs", 0, 2000],
};

const DEFAULTS = { copy: false, steps: 20, holdMs: 150, stepMs: 16, settleMs: 100 };

/**
 * Validate the CLI arguments.
 * @param {unknown} argv the arguments after the script name
 * @returns {{ ok: true, opts: DragOpts } | { ok: false, error: string }}
 */
export function parseDragArgs(argv) {
  if (!Array.isArray(argv)) return { ok: false, error: "arguments must be a list of strings" };
  const opts = { ...DEFAULTS };
  const coords = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (typeof arg !== "string") return { ok: false, error: "arguments must be a list of strings" };
    if (arg === "--copy") {
      opts.copy = true;
    } else if (Object.hasOwn(INT_FLAGS, arg)) {
      const [key, min, max] = INT_FLAGS[arg];
      const value = argv[++i];
      if (value === undefined) return { ok: false, error: `${arg} needs a value` };
      const n = typeof value === "string" && INT_RE.test(value) ? Number(value) : NaN;
      if (!(n >= min && n <= max)) {
        return { ok: false, error: `${arg} must be an integer from ${min} to ${max}` };
      }
      opts[key] = n;
    } else if (arg.startsWith("--")) {
      return { ok: false, error: `unknown flag ${arg}` };
    } else {
      coords.push(arg);
    }
  }
  if (coords.length !== 4) return { ok: false, error: `expected 4 coordinates, got ${coords.length}` };
  const bad = coords.find((c) => !COORD_RE.test(c));
  if (bad !== undefined) return { ok: false, error: `invalid coordinate "${bad}"` };
  const [x1, y1, x2, y2] = coords.map(Number);
  if (Math.hypot(x2 - x1, y2 - y1) < MIN_DRAG_POINTS) {
    return { ok: false, error: `drag distance below ${MIN_DRAG_POINTS} points` };
  }
  return { ok: true, opts: { x1, y1, x2, y2, ...opts } };
}

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * The ordered events for one drag. Pure: the same opts give the same plan.
 * @param {DragOpts} opts validated by `parseDragArgs`
 * @returns {DragEvent[]}
 */
export function buildDragPlan(opts) {
  const { x1, y1, x2, y2, copy, steps, holdMs, stepMs, settleMs } = opts;
  /** @type {DragEvent[]} */
  const plan = [];
  if (copy) plan.push({ type: "altDown" });
  plan.push({ type: "down", x: x1, y: y1, alt: copy });
  plan.push({ type: "wait", ms: holdMs });
  for (let i = 1; i <= steps; i++) {
    const last = i === steps;
    const x = last ? x2 : round2(x1 + ((x2 - x1) * i) / steps);
    const y = last ? y2 : round2(y1 + ((y2 - y1) * i) / steps);
    plan.push({ type: "dragged", x, y, alt: copy });
    plan.push({ type: "wait", ms: stepMs });
  }
  plan.push({ type: "wait", ms: settleMs });
  plan.push({ type: "up", x: x2, y: y2, alt: copy });
  if (copy) plan.push({ type: "altUp" });
  return plan;
}
