// @vitest-environment node
import { describe, expect, it } from "vitest";
// @ts-expect-error -- plain ESM script, no declaration file
import { evaluateIdentity } from "../../scripts/device/identityChecks.mjs";

const releaseId = `0.3.5-dev@${"a".repeat(40)}`;
const bundlePath = "/tmp/mdpro.app";
function facts() {
  const records: Array<{ event: string; status: string; context: { pid?: number; releaseId?: string } }> = [
    { event: "window.open", status: "success", context: { pid: 7 } },
    { event: "app.ready", status: "success", context: { pid: 7, releaseId } },
  ];
  return {
    bundlePath,
    bundleExists: true,
    expectedReleaseId: releaseId,
    processes: [{ pid: 7, exe: `${bundlePath}/Contents/MacOS/tauri-app` }],
    records,
  };
}

describe("device identity failures", () => {
  it("fails and skips window for every added second process", () => {
    for (const pid of [8, 9, 1000]) {
      const input = facts();
      input.processes.push({ pid, exe: "/Applications/mdpro.app/Contents/MacOS/tauri-app" });
      expect(evaluateIdentity(input)).toMatchObject({ exit: 1, lines: ["[PASS] bundle", "[FAIL] process", "[FAIL] releaseId", "[SKIPPED] window"] });
    }
  });

  it("rejects installed and sibling bundles by path boundary", () => {
    for (const exe of ["/Applications/mdpro.app/Contents/MacOS/tauri-app", "/tmp/mdpro.app.old/Contents/MacOS/tauri-app"]) {
      const input = facts();
      input.processes[0].exe = exe;
      expect(evaluateIdentity(input).lines).toContain("[FAIL] process");
      expect(evaluateIdentity(input).lines).toContain("[SKIPPED] window");
    }
  });

  it("rejects unknown, mismatched, and another PID's first ready", () => {
    for (const context of [{ pid: 7, releaseId: "unknown" }, { pid: 7, releaseId: `0.3.5-dev@${"b".repeat(40)}` }, { pid: 8, releaseId }]) {
      const input = facts();
      input.records[1].context = context;
      expect(evaluateIdentity(input).lines).toContain("[FAIL] releaseId");
      expect(evaluateIdentity(input).exit).toBe(1);
    }
  });

  it("refuses window attribution when the ready belongs to another PID", () => {
    const input = facts();
    input.records[1].context.pid = 8;
    expect(evaluateIdentity(input).lines).toEqual(["[PASS] bundle", "[PASS] process", "[FAIL] releaseId", "[FAIL] window"]);
  });

  it("uses the first fresh ready even if a later one matches", () => {
    const input = facts();
    input.records[1].context.releaseId = "unknown";
    input.records.push({ event: "app.ready", status: "success", context: { pid: 7, releaseId } });
    expect(evaluateIdentity(input).lines).toContain("[FAIL] releaseId");
  });

  it("rejects a missing or foreign PID window event", () => {
    for (const context of [{ pid: 8 }, {}]) {
      const input = facts();
      input.records[0].context = context;
      expect(evaluateIdentity(input).lines).toContain("[FAIL] window");
      expect(evaluateIdentity(input).exit).toBe(1);
    }
  });
});
