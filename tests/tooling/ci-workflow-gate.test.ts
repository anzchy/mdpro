// @vitest-environment node
/**
 * ADR95-WI-1: ci.yml's shape under ADR-0095.
 *
 * Branch protection requires one check, `ci-gate`. It must always run, depend
 * on every other job, and fail unless each of them succeeded or was skipped on
 * purpose. The heavy jobs skip only when the scope job says the change is
 * prose-only, and the fast checks (build with tsc, test typecheck, unit tests)
 * stay in the frontend job.
 *
 * D237-WI-1: `cargo audit` runs in its own `rust-audit` job (ADR-0107). It is
 * left out of ci-gate's `needs`, so an advisory shows as a red check on a PR
 * without blocking the landing, and it never sets `continue-on-error`, so a
 * tag or manual run still goes red. `src-tauri/.cargo/audit.toml` may accept
 * only advisories whose triage says they are unreachable.
 */
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { entry, job, jobIds, list, scalar, steps, stepRun as stepRunStrict } from "../support/workflowBlocks";

const AUDIT_TOML = path.resolve(__dirname, "..", "..", "src-tauri", ".cargo", "audit.toml");
const CARGO_TOML = path.resolve(__dirname, "..", "..", "src-tauri", "Cargo.toml");
const TEXT = fs.readFileSync(path.resolve(__dirname, "..", "..", ".github", "workflows", "ci.yml"), "utf8");
const stepRun = stepRunStrict as (step: string | null) => string | null;
const runFile = promisify(execFile);
const runs = (id: string) => steps(job(TEXT, id)).map(stepRun).filter((r): r is string => r !== null);

describe("ADR95-WI-1 ci.yml gate shape", () => {
  it("has the scope, prose-checks, frontend, frontend-merge, rust-test and ci-gate jobs", () => {
    expect(jobIds(TEXT).sort()).toEqual(["ci-gate", "frontend", "frontend-merge", "prose-checks", "rust-audit", "rust-test", "scope"]);
  });

  it("scope exposes the change-scope output", () => {
    const scope = job(TEXT, "scope");
    expect(entry(entry(scope, "outputs")?.body ?? null, "code")?.inline).toBe("${{ steps.scope.outputs.code }}");
    expect(runs("scope").some((r) => r.includes("node scripts/ci/change-scope.mjs"))).toBe(true);
  });

  it.each(["frontend", "rust-test", "rust-audit"])("%s needs scope and runs only for code", (id) => {
    expect(list(job(TEXT, id), "needs")).toEqual(["scope"]);
    expect(scalar(job(TEXT, id), "if")).toBe("needs.scope.outputs.code == 'true'");
  });

  it("frontend keeps build and test typecheck and runs the covered unit lane in shards that frontend-merge merges to JSON", () => {
    const r = runs("frontend");
    for (const cmd of ["pnpm build", "pnpm typecheck:tests", "pnpm exec vitest run --coverage --coverage.thresholds.lines=0 --coverage.thresholds.functions=0 --coverage.thresholds.branches=0 --coverage.thresholds.statements=0 --shard=${{ matrix.shard }}/4 --reporter=default --reporter=blob --reporter=json --outputFile.blob=.vitest-reports/blob-${{ matrix.shard }}-4.json --outputFile.json=.ci-vitest-results.json"]) expect(r).toContain(cmd);
    expect(runs("frontend-merge")).toContain("pnpm exec vitest --merge-reports --coverage --reporter=default --reporter=json --outputFile.json=.ci-vitest-results.json");
  });

  it("checks out the PR head while non-PR runs use the default checkout", () => {
    const checkout = steps(job(TEXT, "frontend")).filter((step) => scalar(step, "uses") === "actions/checkout@v6");
    expect(checkout).toHaveLength(2);
    expect(scalar(checkout[0], "if")).toBe("github.event_name == 'pull_request'");
    expect(scalar(entry(checkout[0], "with")?.body ?? null, "ref")).toBe("${{ github.event.pull_request.head.sha }}");
    expect(scalar(checkout[1], "if")).toBe("github.event_name != 'pull_request'");
    expect(scalar(entry(checkout[0], "with")?.body ?? null, "fetch-depth")).toBe("0");
    expect(scalar(entry(checkout[1], "with")?.body ?? null, "fetch-depth")).toBe("0");
  });

  it("preserves the ci-gate decision bytes from GH607's pinned base", async () => {
    const { stdout: baseline } = await runFile("git", ["show", "a3e9b7ec:.github/workflows/ci.yml"], { encoding: "utf8" });
    const decision = (text: string) => steps(job(text, "ci-gate")).find((step) => scalar(step, "name") === "Every job succeeded, or skipped for a prose-only change");
    // GH639 adds frontend-merge to the success-or-scope-skipped list and its comment, and changes nothing else.
    const withMerge = (step: string | undefined) => step
      ?.replace("frontend and rust-test must\n", "frontend, frontend-merge and rust-test must\n")
      .replace('[.frontend.result, .["rust-test"].result]', '[.frontend.result, .["frontend-merge"].result, .["rust-test"].result]');
    expect(withMerge(decision(baseline))).not.toBe(decision(baseline));
    expect(decision(TEXT)).toBe(withMerge(decision(baseline)));
    expect(scalar(job(TEXT, "ci-gate"), "continue-on-error")).toBeNull();
    expect(list(job(TEXT, "ci-gate"), "needs")).toEqual(["scope", "prose-checks", "frontend", "frontend-merge", "rust-test"]);
  }, 30_000);

  it("runs optional summary diagnostics after the decision without changing gate failures", () => {
    const gateSteps = steps(job(TEXT, "ci-gate"));
    const decisionIndex = gateSteps.findIndex((step) => scalar(step, "name") === "Every job succeeded, or skipped for a prose-only change");
    const checkoutIndex = gateSteps.findIndex((step) => scalar(step, "uses") === "actions/checkout@v6");
    const downloadIndex = gateSteps.findIndex((step) => scalar(step, "uses") === "actions/download-artifact@v4");
    const summaryIndex = gateSteps.findIndex((step) => stepRun(step)?.includes("node scripts/ci/failure-summary.mjs"));
    expect(decisionIndex).toBeGreaterThanOrEqual(0);
    expect(checkoutIndex).toBeGreaterThan(decisionIndex);
    expect(downloadIndex).toBeGreaterThan(checkoutIndex);
    expect(summaryIndex).toBeGreaterThan(downloadIndex);
    for (const index of [checkoutIndex, downloadIndex, summaryIndex]) {
      expect(scalar(gateSteps[index] ?? null, "if")).toBe("${{ !cancelled() }}");
      expect(scalar(gateSteps[index] ?? null, "continue-on-error")).toBe("true");
    }
    const download = entry(gateSteps[downloadIndex] ?? null, "with")?.body ?? null;
    expect(scalar(download, "pattern")).toBe("frontend-vitest-*");
    expect(scalar(download, "path")).toBe(".ci-vitest-artifacts");
    expect(scalar(entry(TEXT, "permissions")?.body ?? null, "contents")).toBe("read");
    expect(entry(entry(TEXT, "permissions")?.body ?? null, "actions")).toBeNull();
    expect(scalar(gateSteps[decisionIndex] ?? null, "continue-on-error")).toBeNull();
  });

  it("bounds optional diagnostics within the ci-gate job budget", () => {
    const gate = job(TEXT, "ci-gate");
    const gateSteps = steps(gate);
    const decisionIndex = gateSteps.findIndex((step) => scalar(step, "name") === "Every job succeeded, or skipped for a prose-only change");
    const diagnostics = gateSteps.slice(decisionIndex + 1);
    expect(diagnostics).toHaveLength(3);
    const budgets = diagnostics.map((step) => {
      expect(scalar(step, "if")).toBe("${{ !cancelled() }}");
      expect(scalar(step, "continue-on-error")).toBe("true");
      const timeout = scalar(step, "timeout-minutes");
      expect(timeout ?? "").toMatch(/^\d+$/);
      return Number(timeout);
    });
    expect(budgets).toEqual([2, 2, 1]);
    expect(Number(scalar(gate, "timeout-minutes"))).toBe(5 + budgets.reduce((sum, budget) => sum + budget, 0));
  });

  it("runs profile and sharded coverage in frontend, and merged coverage, critical checker and comparator in frontend-merge, as authoritative steps", () => {
    const commands: Array<[string, string]> = [
      ["frontend", "node scripts/lint/conditional-tests.mjs"],
      ["frontend", "git rev-parse HEAD"],
      ["frontend", "pnpm exec vitest run --coverage --coverage.thresholds.lines=0 --coverage.thresholds.functions=0 --coverage.thresholds.branches=0 --coverage.thresholds.statements=0 --shard=${{ matrix.shard }}/4 --reporter=default --reporter=blob --reporter=json --outputFile.blob=.vitest-reports/blob-${{ matrix.shard }}-4.json --outputFile.json=.ci-vitest-results.json"],
      ["frontend-merge", "pnpm exec vitest --merge-reports --coverage --reporter=default --reporter=json --outputFile.json=.ci-vitest-results.json"],
      ["frontend-merge", "node scripts/ci/check-critical-coverage.mjs"],
      ["frontend-merge", 'node scripts/ci/compare-report.mjs ci .ci-vitest-results.json tests/ci-inventory.json "$PROFILE" "$PWD"'],
    ];
    for (const [id, command] of commands) {
      const step = steps(job(TEXT, id)).find((item) => stepRun(item) === command);
      expect(step, command).toBeDefined();
      expect(scalar(step ?? null, "continue-on-error"), command).toBeNull();
      expect(scalar(step ?? null, "if"), command).toBeNull();
    }
    expect(steps(job(TEXT, "frontend")).some((step) => stepRun(step)?.includes("node scripts/ci/runner-profile.mjs"))).toBe(true);
  });

  it("retains the merged per-leg JSON report for the delegator's cross-host parity proof", () => {
    const upload = steps(job(TEXT, "frontend-merge")).find((step) => scalar(step, "uses") === "actions/upload-artifact@v4");
    expect(upload).toBeDefined();
    expect(scalar(upload ?? null, "if")).toBe("always()");
    const options = entry(upload ?? null, "with")?.body ?? null;
    expect(scalar(options, "path")).toBe(".ci-vitest-results.json");
    expect(scalar(options, "if-no-files-found")).toBe("error");
  });

  it("includes the hidden JSON report in the upload action's selected files", () => {
    const upload = steps(job(TEXT, "frontend-merge")).find((step) => scalar(step, "uses") === "actions/upload-artifact@v4");
    const options = entry(upload ?? null, "with")?.body ?? null;
    expect(scalar(options, "path")).toBe(".ci-vitest-results.json");
    expect(scalar(options, "include-hidden-files")).toBe("true");
    expect(scalar(options, "if-no-files-found")).toBe("error");
  });

  it("rust-test runs cargo test and no longer runs cargo audit", () => {
    const r = runs("rust-test");
    expect(r).toContain("cargo test --manifest-path src-tauri/Cargo.toml");
    expect(r.some((cmd) => cmd.includes("cargo audit"))).toBe(false);
  });

  it("rust-audit runs cargo audit in src-tauri and fails its own run on an advisory", () => {
    const audit = steps(job(TEXT, "rust-audit")).find((s) => stepRun(s) === "cargo audit");
    expect(audit).toBeDefined();
    expect(scalar(audit ?? null, "working-directory")).toBe("src-tauri");
    expect(scalar(audit ?? null, "continue-on-error")).toBeNull();
    expect(scalar(job(TEXT, "rust-audit"), "continue-on-error")).toBeNull();
  });

  it("pins rmcp features and both reviewed audit ignores with their removal reasons", () => {
    expect(fs.existsSync(AUDIT_TOML)).toBe(true);
    const toml = fs.existsSync(AUDIT_TOML) ? fs.readFileSync(AUDIT_TOML, "utf8") : "";
    const cargo = fs.readFileSync(CARGO_TOML, "utf8");
    const rmcpEntry = /^rmcp\s*=\s*\{[^\n]*\}$/m.exec(cargo)?.[0];
    expect(rmcpEntry).toBeDefined();
    const requestedFeatures = /features\s*=\s*\[([^\]]*)\]/.exec(rmcpEntry ?? "")?.[1];
    expect(requestedFeatures?.match(/"[^"]+"/g)?.map((feature) => feature.slice(1, -1))).toEqual(["server", "transport-io"]);
    expect(requestedFeatures?.replace(/\s/g, "")).toBe('"server","transport-io"');
    const ignore = /^ignore\s*=\s*\[([^\]]*)\]/m.exec(toml)?.[1] ?? "";
    expect(ignore.match(/RUSTSEC-\d{4}-\d{4}/g)).toEqual(["RUSTSEC-2026-0189", "RUSTSEC-2026-0462"]);
    const serverReason = /((?:^\s*#.*\n)+)\s*"RUSTSEC-2026-0189"/m.exec(toml)?.[1] ?? "";
    expect(serverReason).toMatch(/transport-streamable-http-server/);
    expect(serverReason).toMatch(/rmcp 3\.x major bump.*>= 3\.9\.0/);
    const clientReason = /((?:^\s*#.*\n)+)\s*"RUSTSEC-2026-0462"/m.exec(toml)?.[1] ?? "";
    expect(clientReason).toMatch(/transport-streamable-http-client/);
    expect(clientReason).toMatch(/>= 3\.9/);
    expect(toml).toMatch(/d237-cargo-audit-triage/);
  });

  it("prose-checks always runs the ledger check", () => {
    expect(runs("prose-checks")).toContain("node scripts/ledger/check.mjs");
    expect(scalar(job(TEXT, "prose-checks"), "if")).toBeNull();
  });

  it("ci-gate always runs, needs every job but rust-audit, and rejects failed or cancelled results", () => {
    const gate = job(TEXT, "ci-gate");
    expect(scalar(gate, "if")).toBe("always()");
    expect((list(gate, "needs") ?? []).sort()).toEqual(["frontend", "frontend-merge", "prose-checks", "rust-test", "scope"]);
    const script = runs("ci-gate").join("\n");
    expect(script).toContain("toJSON(needs)");
    expect(script).toMatch(/failure/);
    expect(script).toMatch(/cancelled/);
  });
});
