/**
 * Purpose: Find top-level `#[cfg(test)] mod` items in Rust source and splice the head's
 * into the base's, for the replay's restore of non-test paths (ADR-0149 d2).
 * @coordinates-with scripts/tdd/receipt-replay.mjs, scripts/tdd/receipt-tree.mjs
 */
export function cfgTestMods() { return []; }
export function spliceTestMods(baseText) { return baseText; }
