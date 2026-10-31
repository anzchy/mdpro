// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, expectPaneCheckShape, harness, makeToolchain, marker, op, pathEnvs, sideEffects, split } from "./adr0162-wi4-harness";

afterEach(cleanup);

describe.skipIf(process.platform !== "darwin")("ADR0162 WI4 AC-2: the split carries the toolchain PATH (requires macos zsh)", () => {
  it.each([["gpt-imple-2", "implementor"], ["gpt-auditor", "device"], ["gpt-auditor", "auditor"]])("%s %s: split carries PATH=<toolchain>:<script PATH>", async (name, role) => {
    const h = harness(name);
    makeToolchain(h.tc);
    const result = await h.reset(role);
    expect(result.code, result.stderr + result.stdout).toBe(0);
    const calls = h.calls();
    const s = split(calls)!;
    expect(pathEnvs(s)).toEqual([`PATH=${h.tc}:${h.scriptPath}`]);
    expect(s.includes("MDPRO_ROLE=implementor")).toBe(role === "implementor");
    const start = calls.find((call) => op(call) === "agent start")!;
    expect(start.includes("danger-full-access")).toBe(role !== "auditor");
    const ops = sideEffects(calls).map(op);
    if (role === "auditor") {
      expect(ops).toEqual(["install", "pane split", "pane close", "agent start"]);
    } else {
      expect(ops).toEqual(["install", "pane split", "pane run", "pane wait-output", "pane close", "agent start"]);
      expectPaneCheckShape(calls);
    }
    expect(calls.filter((call) => op(call) === "pane close")).toEqual([["pane", "close", "w1:p7"]]);
    expect(fs.readFileSync(marker(h.wt), "utf8")).toBe(role === "device" ? "w1:p8 mode=device\n" : "w1:p8\n");
  }, 10000);

  it("uses the HOME rustup toolchain when the test override is unset", async () => {
    const h = harness();
    makeToolchain(h.defaultTc);
    const result = await h.reset("implementor", { MDPRO_RUST_TOOLCHAIN_BIN: undefined });
    expect(result.code, result.stderr + result.stdout).toBe(0);
    expect(pathEnvs(split(h.calls()))).toEqual([`PATH=${h.defaultTc}:${h.scriptPath}`]);
  }, 10000);

  it.each(["tool chain 工具/bin", "it's/bin"])("implementor with toolchain dir %s: one PATH argv element and a passing in-pane check", async (dir) => {
    const h = harness();
    const tc = makeToolchain(path.join(h.root, dir));
    const result = await h.reset("implementor", { MDPRO_RUST_TOOLCHAIN_BIN: tc });
    expect(result.code, result.stderr + result.stdout).toBe(0);
    const calls = h.calls();
    expect(pathEnvs(split(calls))).toEqual([`PATH=${tc}:${h.scriptPath}`]);
    const run = calls.findIndex((call) => op(call) === "pane run" && call[2] === "w1:p8");
    const close = calls.findIndex((call) => op(call) === "pane close" && call[2] === "w1:p7");
    expect(run).toBeGreaterThanOrEqual(0);
    expect(close).toBeGreaterThan(run);
    expect(fs.readFileSync(marker(h.wt), "utf8")).toBe("w1:p8\n");
  }, 10000);

  it("retries pane run once when the new shell is busy, then starts", async () => {
    const h = harness();
    makeToolchain(h.tc);
    const result = await h.reset("implementor", { FAKE_PANE_BUSY: "once" });
    expect(result.code, result.stderr + result.stdout).toBe(0);
    const calls = h.calls();
    const runs = calls.flatMap((call, i) => op(call) === "pane run" ? [i] : []);
    const wait = calls.findIndex((call) => op(call) === "pane wait-output");
    expect(runs).toHaveLength(2);
    expect(runs.every((i) => calls[i][2] === "w1:p8" && i < wait)).toBe(true);
    expect(fs.readFileSync(marker(h.wt), "utf8")).toBe("w1:p8\n");
  }, 10000);

  it("puts the toolchain ahead of a decoy cargo already on the script PATH", async () => {
    const h = harness();
    makeToolchain(h.tc);
    const decoy = makeToolchain(path.join(h.root, "decoy"));
    const result = await h.reset("implementor", { PATH: `${decoy}:${h.scriptPath}` });
    expect(result.code, result.stderr + result.stdout).toBe(0);
    expect(pathEnvs(split(h.calls()))).toEqual([`PATH=${h.tc}:${decoy}:${h.scriptPath}`]);
  }, 10000);

  it("with no old pane, a successful reset closes no pane", async () => {
    const h = harness();
    makeToolchain(h.tc);
    const result = await h.reset("implementor", { FAKE_NO_OLD: "1" });
    expect(result.code, result.stderr + result.stdout).toBe(0);
    expect(h.calls().filter((call) => op(call) === "pane close")).toEqual([]);
    expect(fs.readFileSync(marker(h.wt), "utf8")).toBe("w1:p8\n");
  }, 10000);
});

