// @vitest-environment node
import fs from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, expectPreSplitRefusal, harness, makeToolchain, marker, op, pathEnvs, sideEffects, split, type Tool } from "./adr0162-wi4-harness";

afterEach(cleanup);

describe.skipIf(process.platform !== "darwin")("ADR0162 WI4 AC-3: auditor resets without a toolchain (requires macos zsh)", () => {
  it.each<[string, Tool, Tool]>([["absent", "absent", "absent"], ["cargo only", "exec", "absent"]])("gpt-auditor auditor with toolchain %s still resets", async (_label, cargo, rustfmt) => {
    const h = harness("gpt-auditor");
    makeToolchain(h.tc, cargo, rustfmt);
    const result = await h.reset("auditor");
    expect(result.code, result.stderr + result.stdout).toBe(0);
    expect(result.stdout).toContain("NEW w1:p8");
    const calls = h.calls();
    expect(sideEffects(calls).map(op)).toEqual(["install", "pane split", "pane close", "agent start"]);
    expect(pathEnvs(split(calls))).toEqual([`PATH=${h.tc}:${h.scriptPath}`]);
    expect(calls.find((call) => op(call) === "agent start")).not.toContain("danger-full-access");
    expect(fs.readFileSync(marker(h.wt), "utf8")).toBe("w1:p8\n");
  }, 10000);

  it("auditor mode still refuses a test-mode override outside tmpdir", async () => {
    const h = harness("gpt-auditor");
    expectPreSplitRefusal(h, await h.reset("auditor", { MDPRO_RUST_TOOLCHAIN_BIN: "/usr/bin" }), "MDPRO_RUST_TOOLCHAIN_BIN");
  }, 10000);
});
