/**
 * Purpose: The CLI half of the device drag driver (D113): validates
 * `x1 y1 x2 y2 [flags]` and prints the drag plan as one JSON array for
 * `drag.swift` to post. All logic lives in `dragPlan.mjs`; this file is I/O.
 *
 * Pipeline: `drag.sh` → `node drag.mjs "$@"` → stdout JSON → `drag-bin`.
 *
 * Key decisions:
 * - A parse error (including a plan over the 30 s `MAX_PLAN_MS` cap, D133)
 *   prints `drag: <error>` and the usage line to stderr, prints nothing to
 *   stdout, and exits 64 (EX_USAGE). `drag.sh` captures stdout
 *   before starting the executor, so no partial plan is ever posted.
 *
 * @module scripts/device/drag
 * @coordinates-with scripts/device/dragPlan.mjs (parseDragArgs, buildDragPlan)
 * @coordinates-with scripts/device/drag.sh (wrapper that pipes the plan)
 */
import { buildDragPlan, parseDragArgs } from "./dragPlan.mjs";

export const EXIT_USAGE = 64;
export const USAGE =
  "usage: drag.sh x1 y1 x2 y2 [--copy] [--steps N] [--hold-ms MS] [--step-ms MS] [--settle-ms MS]";

/* v8 ignore start -- only reached in a real `node scripts/device/drag.mjs` process (device-drag-cli.test.ts spawns one) */
const parsed = parseDragArgs(process.argv.slice(2));
if (parsed.ok) {
  process.stdout.write(`${JSON.stringify(buildDragPlan(parsed.opts))}\n`);
} else {
  process.stderr.write(`drag: ${parsed.error}\n${USAGE}\n`);
  process.exitCode = EXIT_USAGE;
}
/* v8 ignore stop */
