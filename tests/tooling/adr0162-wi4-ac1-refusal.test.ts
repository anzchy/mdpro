// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, expectInPaneRefusal, expectPreSplitRefusal, harness, makeToolchain, op, overlay, tempDirs, type Tool } from "./adr0162-wi4-harness";

afterEach(cleanup);

describe.skipIf(process.platform !== "darwin")("ADR0162 WI4 AC-1: implementor and device refuse without cargo or rustfmt (requires macos zsh)", () => {
  it.each<[string, string, Tool, Tool, string]>([
    ["gpt-imple-2", "implementor", "absent", "absent", "cargo"],
    ["gpt-imple-2", "implementor", "absent", "exec", "cargo"],
    ["gpt-imple-2", "implementor", "exec", "absent", "rustfmt"],
    ["gpt-imple-2", "implementor", "noexec", "exec", "cargo"],
    ["gpt-imple-2", "implementor", "dir", "exec", "cargo"],
    ["gpt-imple-2", "implementor", "exec", "noexec", "rustfmt"],
    ["gpt-imple-2", "implementor", "exec", "dir", "rustfmt"],
    ["gpt-auditor", "device", "absent", "absent", "cargo"],
    ["gpt-auditor", "device", "exec", "absent", "rustfmt"],
    ["opus-imple-1", "implementor", "absent", "absent", "cargo"],
  ])("refuses %s %s with cargo=%s rustfmt=%s before install or any pane action", async (name, role, cargo, rustfmt, names) => {
    const h = harness(name);
    makeToolchain(h.tc, cargo, rustfmt);
    expectPreSplitRefusal(h, await h.reset(role), names);
  }, 10000);

  it("refuses when cargo and rustfmt resolve only from a decoy earlier on the PATH", async () => {
    const h = harness();
    const decoy = makeToolchain(path.join(h.root, "decoy"));
    expectPreSplitRefusal(h, await h.reset("implementor", { PATH: `${decoy}:${h.scriptPath}` }), "cargo");
  }, 10000);

  it.each([
    ["relative", () => "bin"],
    ["outside tmpdir", () => "/usr/bin"],
    ["the tmpdir itself", () => fs.realpathSync(os.tmpdir())],
    ["empty", () => ""],
  ])("refuses a test-mode toolchain override that is %s", async (_label, value) => {
    const h = harness();
    makeToolchain(h.defaultTc);
    expectPreSplitRefusal(h, await h.reset("implementor", { MDPRO_RUST_TOOLCHAIN_BIN: value() }), "MDPRO_RUST_TOOLCHAIN_BIN");
  }, 10000);

  it("refuses an override symlinked from tmpdir to a toolchain outside it", async () => {
    const h = harness();
    const outside = fs.mkdtempSync(path.join(os.homedir(), ".adr0162-wi4-outside-"));
    tempDirs.push(outside);
    makeToolchain(outside);
    const link = path.join(h.root, "link");
    fs.symlinkSync(outside, link);
    expectPreSplitRefusal(h, await h.reset("implementor", { MDPRO_RUST_TOOLCHAIN_BIN: link }), "MDPRO_RUST_TOOLCHAIN_BIN");
  }, 10000);

  it("ignores the override outside test mode and refuses on the missing default toolchain", async () => {
    const h = harness();
    makeToolchain(h.tc);
    const result = await h.reset("implementor", { MDPRO_GUARD_TEST: undefined, MDPRO_GUARD_TEST_MAIN: undefined, FAKE_DELEGATOR_KIND: "claude" });
    expect(result.code, result.stderr).toBe(2);
    expect(result.stderr).toContain("REFUSED: Rust toolchain");
    expect(result.stderr).not.toContain("overlay");
    expect(h.calls().some((call) => op(call) === "pane split")).toBe(false);
    expect(fs.existsSync(overlay(h.wt))).toBe(false);
  }, 10000);

  it.each<[string, string, (h: ReturnType<typeof harness>) => string]>([
    ["gpt-imple-2", "a profile that drops the toolchain", () => "/usr/bin:/bin"],
    ["gpt-imple-2", "a pane PATH with cargo only", (h) => makeToolchain(path.join(h.root, "cargo-only"), "exec", "absent")],
    ["gpt-imple-2", "a pane PATH with rustfmt only", (h) => makeToolchain(path.join(h.root, "rustfmt-only"), "absent", "exec")],
    ["gpt-imple-2", "a profile that puts a decoy toolchain first", (h) => `${makeToolchain(path.join(h.root, "decoy"))}:${h.tc}`],
    ["gpt-imple-2", "a rustfmt-only decoy ahead of the toolchain", (h) => `${makeToolchain(path.join(h.root, "decoy-r"), "absent", "exec")}:${h.tc}:/usr/bin:/bin`],
    ["gpt-imple-2", "a cargo-only decoy ahead of the toolchain", (h) => `${makeToolchain(path.join(h.root, "decoy-c"), "exec", "absent")}:${h.tc}:/usr/bin:/bin`],
    ["gpt-auditor", "a profile that drops the toolchain", () => "/usr/bin:/bin"],
  ])("%s: in-pane check refuses under %s, closes only the new pane", async (name, _label, panePath) => {
    const h = harness(name);
    makeToolchain(h.tc);
    const role = name === "gpt-auditor" ? "device" : "implementor";
    expectInPaneRefusal(h, await h.reset(role, { FAKE_PANE_PATH_OVERRIDE: panePath(h) }));
  }, 10000);

  it("refuses when the new pane's shell stays busy on every pane run", async () => {
    const h = harness();
    makeToolchain(h.tc);
    const result = await h.reset("implementor", { FAKE_PANE_BUSY: "always" });
    expect(result.code, result.stderr + result.stdout).toBe(2);
    expect(result.stderr).toContain("REFUSED");
    const calls = h.calls();
    expect(calls.filter((call) => op(call) === "pane close")).toEqual([["pane", "close", "w1:p8"]]);
    expect(calls.some((call) => op(call) === "agent start")).toBe(false);
    expect(calls.filter((call) => op(call) === "pane run").every((call) => call[2] === "w1:p8")).toBe(true);
    expect(fs.existsSync(path.join(h.wt, ".codex/rules/.started-at"))).toBe(false);
  }, 10000);

  it("with no old pane, an in-pane failure closes only the new pane", async () => {
    const h = harness();
    makeToolchain(h.tc);
    expectInPaneRefusal(h, await h.reset("implementor", { FAKE_NO_OLD: "1", FAKE_PANE_PATH_OVERRIDE: "/usr/bin:/bin" }), null);
  }, 10000);
});

