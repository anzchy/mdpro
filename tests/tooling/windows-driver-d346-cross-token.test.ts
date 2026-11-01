// @vitest-environment node
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ast } from "./windows-driver-d344-harness";
import { crossTokenProbe, type ProbeMode } from "./windows-driver-d346-cross-token-harness";

const preserved = ["preserve-native-session-blocked.json", "preserve-owned-processes.json"];
const refused: ProbeMode[] = ["unrestricted", "admin-enabled", "wrong-job", "wrong-nonce", "wrong-user", "denied", "malformed", "missing", "launcher-only", "timeout", "truthy-restricted", "truthy-opened", "invalid-pid", "missing-birth"];

describe("D346 separate filtered-token probe (enumerate A5, added by ruling2)", () => {
  it("accepts only a restricted same-user exact-job open and cleans its resources", async () => {
    const r = await crossTokenProbe("success");
    expect(r.status, r.stderr + r.stdout).toBe(0);
    expect(r.stdout).toMatch(/^OK restricted-open\b/m);
    expect(r.stdout).toMatch(/^OK cleanup\b/m);
    expect(r.trace.filter((line) => line.startsWith("create:"))).toHaveLength(1);
    expect(r.trace.find((line) => line.startsWith("create:"))).toMatch(/:False$/);
    expect(r.trace.filter((line) => line.startsWith("launch:"))).toHaveLength(1);
    expect(r.trace.find((line) => line.startsWith("arguments:"))).toContain("/trustlevel:0x20000");
    expect(r.survivors).toEqual([]);
    expect(r.retainedReplies).toEqual([false]);
    expect(r.preserved).toEqual(preserved);
  }, 15000);

  it.each(refused)("refuses %s without accepting launcher success as proof", async (mode) => {
    const r = await crossTokenProbe(mode);
    expect(r.status, r.stderr + r.stdout).toBe(1);
    expect(r.stdout).toMatch(/^FAIL restricted-open\b/m);
    expect(r.stdout).not.toMatch(/^OK restricted-open\b/m);
    expect(r.stdout).toMatch(/^OK cleanup\b/m);
    expect(r.survivors).toEqual([]);
    expect(r.retainedReplies).toEqual([false]);
    expect(r.preserved).toEqual(preserved);
    // PhaseMs bounds waiting; process startup is deliberately outside this bound.
    expect(r.elapsedMs).toBeLessThan(10000);
  }, 15000);

  it.each(["create-failed", "launch-failed", "cleanup-failed"] as const)("names %s and retains cleanup truth", async (mode) => {
    const r = await crossTokenProbe(mode);
    expect(r.status, r.stderr + r.stdout).toBe(1);
    expect(r.stdout).toMatch(/^FAIL /m);
    if (mode === "cleanup-failed") expect(r.stdout).toMatch(/^FAIL cleanup\b/m);
    else expect(r.stdout).not.toMatch(/^OK restricted-open\b/m);
    expect(r.survivors).toEqual([]);
    expect(r.preserved).toEqual(preserved);
  }, 15000);

  it("keeps all active effects within the named job, child and temporary reply", async () => {
    const r = await crossTokenProbe("success");
    const parsed = await ast(r.source);
    expect(r.stdout).toMatch(/^OK restricted-open\b/m);
    expect(parsed.errors).toEqual([]);
    expect(parsed.commands.filter((command) => /(?:ScheduledTask|SendInput|reconcile)/i.test(command.name ?? ""))).toEqual([]);
    expect(parsed.methods.filter((method) => /(?:SendInput|mouse_event|keybd_event)/i.test(method))).toEqual([]);
    // Both filenames are protected runtime canaries, and are also forbidden in
    // the complete script, including any inactive child/helper branch.
    expect(r.source).not.toMatch(/native-session-blocked|owned-processes|native-session\.lock/i);
    expect(r.survivors).toEqual([]);
    expect(r.retainedReplies).toEqual([false]);
    expect(r.preserved).toEqual(preserved);
  }, 15000);
});


describe("D346 ruling14 regressions (enumerate)", () => {
  it("F14-1 launches rooted runas with spaces and names its absence", async () => {
    const success = await crossTokenProbe("success");
    expect(success.status, success.stderr + success.stdout).toBe(0);
    expect(success.trace.find((line) => line.startsWith("launch:"))).toBe("launch:" + path.join(success.systemRoot, "System32", "runas.exe"));
    expect(success.stdout.trim().split(/\r?\n/)).toEqual(["OK job-created", "OK child-started", "OK restricted-open", "OK cleanup"]);
    const absent = await crossTokenProbe("runas-absent");
    expect(absent.status).toBe(1);
    expect(absent.stdout).toContain("FAIL restricted-open runas-missing " + path.join(absent.systemRoot, "System32", "runas.exe"));
    expect(absent.trace.filter((line) => line.startsWith("launch:"))).toEqual([]);
    expect(absent.stdout).toMatch(/^OK cleanup$/m);
    expect(absent.survivors).toEqual([]);
    expect(absent.preserved).toEqual(preserved);
  }, 20000);

  it.each(["success", "timeout", "unrestricted", "launch-failed"] as const)("F14-2 bounds File launch and removes the script after %s", async (mode) => {
    const r = await crossTokenProbe(mode);
    const argumentsLine = r.trace.find((line) => line.startsWith("arguments:")) ?? "";
    const program = argumentsLine.split("/trustlevel:0x20000 ")[1] ?? "";
    expect(program).toContain("-File ");
    expect(program).not.toContain("-EncodedCommand");
    expect(program.length).toBeLessThan(1024);
    expect(r.trace.find((line) => line.startsWith("body:"))).toMatch(/^body:[1-9][0-9]+$/);
    expect(r.trace.filter((line) => line.startsWith("script:"))).toHaveLength(1);
    expect(r.retainedScripts).toEqual([false]);
    expect(r.survivors).toEqual([]);
    expect(r.status, r.stderr + r.stdout).toBe(mode === "success" ? 0 : 1);
  }, 15000);

  it("F14-3 prints only allowlisted reply fields on invalid reply", async () => {
    const r = await crossTokenProbe("unrestricted");
    expect(r.status).toBe(1);
    const line = r.stdout.split(/\r?\n/).find((value) => value.startsWith("FAIL restricted-open restricted-reply-invalid ")) ?? "";
    const diagnostic = JSON.parse(line.slice("FAIL restricted-open restricted-reply-invalid ".length) || "null");
    const reply = JSON.parse(r.trace.find((value) => value.startsWith("reply-json:"))?.slice(11) ?? "null");
    expect(diagnostic).toEqual(reply);
    expect(Object.keys(diagnostic ?? {}).sort()).toEqual(["nonce", "job", "userSid", "restricted", "adminEnabled", "opened", "pid", "birth"].sort());
    expect(r.stdout).not.toContain("DO_NOT_PRINT");
    expect(r.stdout).toMatch(/^OK cleanup$/m);
  }, 15000);
});
