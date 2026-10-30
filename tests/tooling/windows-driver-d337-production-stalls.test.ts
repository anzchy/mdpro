// @vitest-environment node
import { writeFileSync } from "node:fs";
import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { startFakeCdp, type FakePage } from "../support/fakeCdp";
import { productionWorkerFixture, type ProductionStall } from "./windows-driver-native-production-harness";

// Each case runs the supervisor, its Scheduler children and the production worker in PowerShell.
vi.setConfig({ testTimeout: 40_000 });

const outcome = (lines: string[]) => JSON.parse(lines.filter((v) => v.startsWith("OUTCOME ")).at(-1)!.slice(8));
async function exists(file: string) { try { await access(file); return true; } catch { return false; } }
function alive(pid: number) { try { process.kill(pid, 0); return true; } catch { return false; } }
const clickThenSelectAll = [{ op: "clickat", x: 100, y: 100 }, { op: "chord", keys: ["ctrl+a"], nofocus: true }];
const identity = [{ label: "A", pageId: "p1", rect: [0, 0, 800, 600] }];
const inputTrace = (trace: string[]) => trace.filter((line) => /^(mouse|logical|scan):/.test(line));

async function membersGone(dir: string) {
  const members = (await readFile(path.join(dir, "members"), "utf8")).trim().split("\n").map(Number);
  return members.length > 0 && members.every((pid) => !alive(pid));
}

/** A labelled page whose bind or unbind never answers, at the CDP boundary only. */
async function titlePage(hangOn: "bind" | "unbind") {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mdpro-production-title-"));
  const titlePath = path.join(dir, "title.txt");
  await writeFile(titlePath, "mdpro");
  const page: FakePage = {
    id: "p1",
    hang: (_method, expression) => expression.includes(hangOn === "bind" ? "IDENTITY_STALE_BEFORE_BIND" : "IDENTITY_UNBIND_MARKER_MISSING"),
    evaluate: (expression) => {
      if (expression.includes("IDENTITY_STALE_BEFORE_BIND")) {
        const nonce = /mdpro-b7:([a-f0-9]{32})/.exec(expression)?.[1];
        const challenge = `mdpro [mdpro-b7:${nonce}]`;
        writeFileSync(titlePath, challenge);
        return { result: { type: "object", value: { label: "A", rect: [0, 0, 800, 600], challenge } } };
      }
      if (expression.includes("IDENTITY_UNBIND_MARKER_MISSING")) {
        writeFileSync(titlePath, "mdpro");
        return { result: { type: "object", value: { label: "A", restored: true } } };
      }
      return { result: { type: "string", value: "A" } };
    },
  };
  return { titlePath, server: await startFakeCdp([page]) };
}

describe("D337 production worker under the real supervisor", () => {
  it("completes clickat + Ctrl+A through the production worker with no stall", async () => {
    const fixture = await productionWorkerFixture("none", clickThenSelectAll);
    const result = await fixture.start().result;
    expect(result.status, result.stderr + result.lines.join(" ")).toBe(0);
    expect(outcome(result.lines)).toMatchObject({ status: "completed", completedSteps: 2, cleanup: "complete", heldInput: "released" });
    expect(inputTrace(await fixture.traceLines())).toEqual(["mouse:2", "mouse:4", "logical:17:0", "logical:65:0", "logical:65:2", "logical:17:2"]);
    expect(await membersGone(fixture.dir)).toBe(true);
  });

  it.each<[ProductionStall, string]>([
    ["discovery", "discovery"],
    ["uia", "uia-discovery"],
    ["uia-read", "uia-discovery"],
    ["resolver", "window-resolver"],
    ["stdout", "window-resolver"],
  ])("a %s stall before input returns a nonzero, phase-named result with no input sent", async (stall, phase) => {
    const fixture = await productionWorkerFixture(stall, clickThenSelectAll);
    const started = Date.now();
    const result = await fixture.start().result;
    expect(result.status, result.stderr + result.lines.join(" ")).not.toBe(0);
    const value = outcome(result.lines);
    expect(value.phase).toContain(phase);
    expect(value).toMatchObject({ status: "failed", step: 1, op: "clickat", completedSteps: 0, inputOutcome: "none", heldInput: "released", cleanup: "complete" });
    expect(Date.now() - started).toBeLessThan(30000);
    expect(inputTrace(await fixture.traceLines())).toEqual([]);
    expect(await membersGone(fixture.dir)).toBe(true);
    expect(await exists(path.join(fixture.dir, "task"))).toBe(false);
    const durable = JSON.parse(await readFile(path.join(fixture.dir, "runs", fixture.runId, "result.json"), "utf8"));
    expect(durable).toMatchObject({ runId: fixture.runId, phase: value.phase, inputOutcome: "none" });
  });

  it("a title-bind stall at CDP fails in title-bind before input and still restores the title", async () => {
    const { titlePath, server } = await titlePage("bind");
    try {
      const fixture = await productionWorkerFixture("none", [
        { op: "chord", window: "A", _identity: identity, keys: ["ctrl+a"], nofocus: true },
      ], { cdpPort: server.port, titlePath });
      const result = await fixture.start().result;
      expect(result.status, result.stderr + result.lines.join(" ")).not.toBe(0);
      const value = outcome(result.lines);
      expect(value.phase).toContain("title-bind");
      expect(value).toMatchObject({ status: "failed", completedSteps: 0, inputOutcome: "none" });
      expect(inputTrace(await fixture.traceLines())).toEqual([]);
      expect(await membersGone(fixture.dir)).toBe(true);
    } finally { await server.close(); }
  });

  it("a title-restore stall after input fails in title-restore, keeps the input outcome and latches", async () => {
    const { titlePath, server } = await titlePage("unbind");
    try {
      const fixture = await productionWorkerFixture("none", [
        { op: "chord", window: "A", _identity: identity, keys: ["ctrl+a"], nofocus: true },
      ], { cdpPort: server.port, titlePath });
      const result = await fixture.start().result;
      expect(result.status, result.stderr + result.lines.join(" ")).not.toBe(0);
      const value = outcome(result.lines);
      expect(value.phase).toContain("title-restore");
      expect(value.completedSteps).toBe(1);
      expect(["partial", "unknown"]).toContain(value.inputOutcome);
      expect(value.status).toBe("failed");
      expect(inputTrace(await fixture.traceLines())).toEqual(["logical:17:0", "logical:65:0", "logical:65:2", "logical:17:2"]);
      expect(await membersGone(fixture.dir)).toBe(true);
      expect(await exists(path.join(fixture.dir, "native-session-blocked.json"))).toBe(true);
      const later = await fixture.start("c".repeat(32)).result;
      expect(later.lines.join(" ")).toContain("NATIVE_RECONCILIATION_REQUIRED");
    } finally { await server.close(); }
  });
});
