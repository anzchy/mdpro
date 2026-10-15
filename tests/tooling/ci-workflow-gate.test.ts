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
import { describe, expect, it } from "vitest";
import { entry, job, jobIds, list, scalar, steps, stepRun } from "../support/workflowBlocks";

const AUDIT_TOML = path.resolve(__dirname, "..", "..", "src-tauri", ".cargo", "audit.toml");
const TEXT = fs.readFileSync(path.resolve(__dirname, "..", "..", ".github", "workflows", "ci.yml"), "utf8");
const runs = (id: string) => steps(job(TEXT, id)).map(stepRun).filter((r): r is string => r !== null);

describe("ADR95-WI-1 ci.yml gate shape", () => {
  it("has the scope, prose-checks, frontend, rust-test and ci-gate jobs", () => {
    expect(jobIds(TEXT).sort()).toEqual(["ci-gate", "frontend", "prose-checks", "rust-audit", "rust-test", "scope"]);
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

  it("frontend keeps the fast checks", () => {
    const r = runs("frontend");
    for (const cmd of ["pnpm build", "pnpm typecheck:tests", "pnpm test:run"]) expect(r).toContain(cmd);
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

  it("audit.toml accepts only RUSTSEC-2026-0189, with a reason", () => {
    expect(fs.existsSync(AUDIT_TOML)).toBe(true);
    const toml = fs.existsSync(AUDIT_TOML) ? fs.readFileSync(AUDIT_TOML, "utf8") : "";
    const ignore = /^ignore\s*=\s*\[([^\]]*)\]/m.exec(toml)?.[1] ?? "";
    expect(ignore.match(/RUSTSEC-\d{4}-\d{4}/g)).toEqual(["RUSTSEC-2026-0189"]);
    expect(toml).toMatch(/transport-streamable-http-server/);
    expect(toml).toMatch(/d237-cargo-audit-triage/);
  });

  it("prose-checks always runs the ledger check", () => {
    expect(runs("prose-checks")).toContain("node scripts/ledger/check.mjs");
    expect(scalar(job(TEXT, "prose-checks"), "if")).toBeNull();
  });

  it("ci-gate always runs, needs every job but rust-audit, and rejects failed or cancelled results", () => {
    const gate = job(TEXT, "ci-gate");
    expect(scalar(gate, "if")).toBe("always()");
    expect((list(gate, "needs") ?? []).sort()).toEqual(["frontend", "prose-checks", "rust-test", "scope"]);
    const script = runs("ci-gate").join("\n");
    expect(script).toContain("toJSON(needs)");
    expect(script).toMatch(/failure/);
    expect(script).toMatch(/cancelled/);
  });
});
