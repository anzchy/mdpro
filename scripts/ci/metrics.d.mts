/** Types for metrics.mjs (MIG-003d), so tests can import it under strict tsc. */
import type { Metrics, MetricsInput } from "./metrics-core.mjs";

export type { BudgetRow, Job, Metrics, MetricsInput, Report, ReportTest, Run, Stat, Window } from "./metrics-core.mjs";
export { computeMetrics, percentile } from "./metrics-core.mjs";
export type Request = (method: string, path: string, options?: { paginate?: boolean; binary?: boolean }) => unknown;
export interface Deps {
  env?: Record<string, string | undefined>;
  home?: string;
  request?: Request;
  now?: Date;
  tmpRoot?: string;
  stdout?: (s: string) => void;
  stderr?: (s: string) => void;
}

export declare function parseArgs(argv: readonly string[]): { ok: true; since: string; until: string; label: string; scopeRefP90: number | null } | { ok: false; error: string };
export declare function resolveOutDir(env: Record<string, string | undefined>, home: string): { ok: true; dir: string } | { ok: false; error: string };
export declare function makeGhRequest(deps?: { spawn?: (cmd: string, args: string[], options: object) => { status: number | null; stdout: Buffer | string; stderr: Buffer | string } }): Request;
export declare function collect(request: Request, window: { since: string; until: string }, options?: { tmpRoot?: string }): Promise<MetricsInput>;
export declare function renderSummary(metrics: Metrics): string;
export declare function main(argv: readonly string[], deps?: Deps): Promise<number>;
