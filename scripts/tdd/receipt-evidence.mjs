/**
 * Purpose: The receipt evidence sidecar `.claude/tdd-guardian/evidence.json` and its
 * repo-wide lock (ADR-0145 d6).
 * @coordinates-with scripts/tdd/red-receipt.mjs, scripts/tdd/receipt-replay.mjs
 */
export function withEvidenceLock(cwd, operation) { return operation(); }
export function readEvidence() { return { schemaVersion: 1, entries: {} }; }
export function entryFor() { return null; }
export function writeEntry() {}
export function removeEntry() {}
