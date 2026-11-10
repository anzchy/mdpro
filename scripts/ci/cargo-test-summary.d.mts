/** Types for cargo-test-summary.mjs, imported by strict TypeScript tests. */
export interface CargoTestSummary { ok: boolean; passed: number; failed: number; message: string }
export declare function checkCargoTestLog(text: string): CargoTestSummary;
export declare function main(argv: string[]): number;
