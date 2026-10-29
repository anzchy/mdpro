/**
 * Purpose: The RED-time test tree (ADR-0149 d1): which paths are test paths, the tree
 * of their working-tree bytes, and the create-only ref that pins it.
 * @coordinates-with scripts/tdd/red-receipt.mjs, scripts/tdd/receipt-replay.mjs
 */
export function testPaths() { return []; }
export function isTestPath() { return false; }
export function buildTree() { return ""; }
export function refFor() { return ""; }
export function pinRef() {}
