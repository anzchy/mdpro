// @vitest-environment node
/**
 * ADR95-WI-1: ci.yml's shape under ADR-0095.
 *
 * Branch protection requires one check, `ci-gate`. It must always run, depend
 * on every other job, and fail unless each of them succeeded or was skipped on
 * purpose. The heavy jobs skip only when the scope job says the change is
 * prose-only, and the fast checks (build with tsc, test typecheck, unit tests)
 * stay in the frontend job.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { entry, job, jobIds, list, scalar, steps, stepRun } from "./support/workflowBlocks";

const TEXT = fs.readFileSync(path.resolve(__dirname, "..", ".github", "workflows", "ci.yml"), "utf8");
const runs = (id: string) => steps(job(TEXT, id)).map(stepRun).filter((r): r is string => r !== null);

describe("ADR95-WI-1 ci.yml gate shape", () => {
  it("has the scope, prose-checks, frontend, rust-test and ci-gate jobs", () => {
    expect(jobIds(TEXT).sort()).toEqual(["ci-gate", "frontend", "prose-checks", "rust-test", "scope"]);
  });

  it("scope exposes the change-scope output", () => {
    const scope = job(TEXT, "scope");
    expect(entry(entry(scope, "outputs")?.body ?? null, "code")?.inline).toBe("${{ steps.scope.outputs.code }}");
    expect(runs("scope").some((r) => r.includes("node scripts/ci/change-scope.mjs"))).toBe(true);
  });

  it.each(["frontend", "rust-test"])("%s needs scope and runs only for code", (id) => {
    expect(list(job(TEXT, id), "needs")).toEqual(["scope"]);
    expect(scalar(job(TEXT, id), "if")).toBe("needs.scope.outputs.code == 'true'");
  });

  it("frontend keeps the fast checks", () => {
    const r = runs("frontend");
    for (const cmd of ["pnpm build", "pnpm typecheck:tests", "pnpm test:run"]) expect(r).toContain(cmd);
  });

  it("prose-checks always runs the ledger check", () => {
    expect(runs("prose-checks")).toContain("node scripts/ledger/check.mjs");
    expect(scalar(job(TEXT, "prose-checks"), "if")).toBeNull();
  });

  it("ci-gate always runs, needs every other job, and rejects failed or cancelled results", () => {
    const gate = job(TEXT, "ci-gate");
    expect(scalar(gate, "if")).toBe("always()");
    expect((list(gate, "needs") ?? []).sort()).toEqual(["frontend", "prose-checks", "rust-test", "scope"]);
    const script = runs("ci-gate").join("\n");
    expect(script).toContain("toJSON(needs)");
    expect(script).toMatch(/failure/);
    expect(script).toMatch(/cancelled/);
  });
});
