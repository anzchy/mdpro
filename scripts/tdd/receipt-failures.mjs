/**
 * Purpose: Parse a RED or replay run into per-test outcomes (ADR-0145 d1, ADR-0149 d1):
 * Vitest JSON and libtest text → Map<id, {status, kind, location, message}>.
 * @coordinates-with scripts/tdd/red-receipt.mjs, scripts/tdd/receipt-replay.mjs
 */
export function vitestOutcomes() { return new Map(); }
export function libtestOutcomes() { return { outcomes: new Map(), compileError: false }; }
export function failuresOf() { return []; }
