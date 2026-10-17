/**
 * Purpose: the exhaustiveness guard for `switch` statements over a closed
 * union (rule 60 § Enum completeness). Reaching it at runtime means a value
 * outside the union got through; at compile time, a missing arm fails `tsc`.
 */
export function assertNever(value: never): never {
  throw new Error(`Unhandled union member: ${String(value)}`);
}
