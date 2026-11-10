/** Types for metrics-core.mjs (MIG-003d), the pure seam, so tests can import it under strict tsc. */
export interface Run {
  id: number;
  event: string;
  head_sha: string;
  head_branch?: string;
  run_attempt: number;
  status: string;
  conclusion: string | null;
  run_started_at: string;
  created_at: string;
  updated_at?: string;
  pull_requests?: { number: number }[];
  head_repository?: { full_name: string };
}
export interface Job {
  id: number;
  run_attempt: number;
  name: string;
  status: string;
  conclusion: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  labels: string[];
  steps?: { name: string; conclusion: string | null }[];
}
export interface ReportTest { file: string; fullName: string; status: string }
export interface Report { artifact: string; tests: ReportTest[] }
export interface MetricsInput {
  runs: Record<string, Run[]>;
  attempts: Record<string, Run[]>;
  jobs: Record<string, Job[]>;
  reports: Record<string, Report[] | null>;
}
export interface Window { since: string; until: string; label: string; scopeRefP90?: number | null }
export interface Stat { samples: number; p50: number | null; p90: number | null }
export interface BudgetRow { lane: string; samples: number; p90: number | null; budget: number | null; delta?: number | null; status: string }
export interface Metrics {
  label: string;
  window: { since: string; until: string };
  wallClock: Stat;
  queue: Stat;
  minutes: Record<string, number>;
  rerun: { headShas: number; rerun: number; rate: number | null };
  flake: string | { candidates: number; flakyTests: string[]; flakyShas: number; rate: number | null };
  nightly: Record<string, { runs: number; passRate: number | null }>;
  budgets: BudgetRow[];
}
export declare function percentile(values: readonly number[], p: number): number | null;
export declare function computeMetrics(input: MetricsInput, window: Window): Metrics;
export declare const ADVISORY: readonly string[];
export declare const BLOB: RegExp;
export declare const PER_SHARD: RegExp;
export declare function candidates(input: MetricsInput): Run[][];
