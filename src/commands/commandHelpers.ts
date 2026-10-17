/**
 * Purpose: exhaustive helpers over the command table's closed unions. Each
 * `switch` lists every literal, with no `default:`, and is followed by `assertNever`,
 * so adding a `Route` or `Availability` literal fails `tsc` until it is
 * handled here (plan M1A-WI-4; matrix SD12).
 *
 * @coordinates-with src/commands/commandTable.types.ts — the unions
 * @coordinates-with src/commands/rowBuilders.ts — derives row contexts
 */
import { assertNever } from "./assertNever";
import type { Availability, OwnershipContext, Route } from "./commandTable.types";

/** Who writes the log line when a command on this route runs (SD12). */
export type LogOwner = "frontend" | "native" | "rust";

export function routeLogOwner(route: Route): LogOwner {
  switch (route) {
    case "frontend":
      return "frontend";
    case "native":
      return "native";
    case "rust-quit":
      return "rust";
    case "rust-hide":
      return "rust";
    case "unavailable":
      // A stale event carrying an unavailable id is refused, and logged, by
      // the frontend dispatcher (§ 5.5).
      return "frontend";
  }
  return assertNever(route);
}

/** The editor contexts a command acts in, given the modes it works in. */
export function availabilityContexts(availability: Availability): readonly OwnershipContext[] {
  switch (availability) {
    case "both":
      return ["editorW", "editorS", "tableW", "tableS"];
    case "W":
      return ["editorW", "tableW"];
    case "S":
      return ["editorS", "tableS"];
    case "none":
      return [];
  }
  return assertNever(availability);
}
