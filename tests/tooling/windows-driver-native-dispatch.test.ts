// @vitest-environment node
import { writeFileSync } from "node:fs";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { startFakeCdp, type FakePage } from "../support/fakeCdp";
import { runNative } from "./windows-driver-native-harness";

describe("B7 native PowerShell dispatch against controlled OS observations", () => {
  it("binds the labelled page to the challenged native title and restores it", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mdpro-title-challenge-"));
    const titlePath = path.join(dir, "title.txt");
    await fs.writeFile(titlePath, "mdpro");
    const page: FakePage = { id: "p1", evaluate: (expression) => {
      if (expression.includes("IDENTITY_STALE_BEFORE_BIND")) {
        const nonce = /mdpro-b7:([a-f0-9]{32})/.exec(expression)?.[1];
        if (!nonce) return { result: { type: "object" }, exceptionDetails: { text: "no nonce" } };
        const challenge = `mdpro [mdpro-b7:${nonce}]`;
        writeFileSync(titlePath, challenge);
        return { result: { type: "object", value: { label: "A", rect: [0, 0, 800, 600], challenge } } };
      }
      if (expression.includes("IDENTITY_UNBIND_MARKER_MISSING")) {
        writeFileSync(titlePath, "mdpro");
        return { result: { type: "object", value: { label: "A", restored: true } } };
      }
      return { result: { type: "string", value: "A" } };
    } };
    const server = await startFakeCdp([page]);
    try {
      const result = await runNative([
        { op: "chord", window: "A", _identity: [{ label: "A", pageId: "p1", rect: [0, 0, 800, 600] }],
          keys: ["ctrl+a"], nofocus: true },
      ], {}, { cdpPort: server.port, titlePath });
      expect(result.status, JSON.stringify(result)).toBe(0);
      expect(result.trace.filter((line) => line.startsWith("logical:"))).toEqual([
        "logical:17:0", "logical:65:0", "logical:65:2", "logical:17:2",
      ]);
      expect(await fs.readFile(titlePath, "utf8")).toBe("mdpro");
    } finally { await server.close(); }
  });

  it.each([
    ["replaced page", "new-page", false],
    ["swapped geometry", "old-page", true],
  ])("rejects a %s before the first labelled native input", async (_case, livePageId, changedRect) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mdpro-title-stale-"));
    const titlePath = path.join(dir, "title.txt");
    await fs.writeFile(titlePath, "mdpro");
    const page: FakePage = { id: livePageId, evaluate: (expression) => {
      if (expression.includes("IDENTITY_STALE_BEFORE_BIND") && changedRect)
        return { result: { type: "object" }, exceptionDetails: { text: "IDENTITY_STALE_BEFORE_BIND" } };
      if (expression.includes("IDENTITY_UNBIND_MARKER_MISSING"))
        return { result: { type: "object" }, exceptionDetails: { text: "IDENTITY_UNBIND_MARKER_MISSING" } };
      return { result: { type: "string", value: "A" } };
    } };
    const server = await startFakeCdp([page]);
    try {
      const result = await runNative([
        { op: "chord", window: "A", _identity: [{ label: "A", pageId: "old-page", rect: [0, 0, 800, 600] }],
          keys: ["ctrl+a"], nofocus: true, onError: "continue" },
        { op: "chord", keys: ["ctrl+b"], nofocus: true },
      ], {}, { cdpPort: server.port, titlePath });
      expect(result.status, JSON.stringify(result)).toBe(1);
      expect(result.log.join(" ")).toContain("ABORTED at step 1");
      expect(result.trace.filter((line) => line.startsWith("logical:"))).toEqual([]);
      expect(await fs.readFile(titlePath, "utf8")).toBe("mdpro");
    } finally { await server.close(); }
  });

  it("runs a sole-window logical chord through the production dispatcher", async () => {
    const result = await runNative([{ op: "chord", keys: ["ctrl+a"], nofocus: true }]);
    expect(result.status, JSON.stringify(result)).toBe(0);
    expect(result.trace.filter((line) => line.startsWith("logical:"))).toEqual([
      "logical:17:0", "logical:65:0", "logical:65:2", "logical:17:2",
    ]);
  });

  it("rechecks native bounds after the resolver and aborts before a continued mutation", async () => {
    const result = await runNative([
      { op: "chord", keys: ["ctrl+a"], nofocus: true, onError: "continue" },
      { op: "chord", keys: ["ctrl+b"], nofocus: true },
    ], { rectChangeAt: 2 });
    expect(result.status, JSON.stringify(result)).toBe(1);
    expect(result.log.join(" ")).toMatch(/IDENTITY_NATIVE_RECT_CHANGED.*ABORTED at step 1/);
    expect(result.trace.filter((line) => line.startsWith("logical:"))).toEqual([]);
  });

  it("releases logical keys when identity fails between down and up", async () => {
    const result = await runNative([
      { op: "chord", keys: ["ctrl+a"], nofocus: true, onError: "continue" },
      { op: "chord", keys: ["ctrl+b"], nofocus: true },
    ], { focusChangesAfterLogicalDown: true });
    expect(result.status, JSON.stringify(result)).toBe(1);
    expect(result.trace.filter((line) => line.startsWith("logical:"))).toEqual([
      "logical:17:0", "logical:17:2",
    ]);
    expect(result.log.join(" ")).toContain("ABORTED at step 1");
  });

  it("releases a mouse button when identity fails between down and up", async () => {
    const result = await runNative([
      { op: "clickat", x: 100, y: 100, nofocus: true, onError: "continue" },
      { op: "chord", keys: ["ctrl+b"], nofocus: true },
    ], { focusChangesAfterMouseDown: true });
    expect(result.status, JSON.stringify(result)).toBe(1);
    expect(result.trace.filter((line) => line.startsWith("mouse:"))).toEqual(["mouse:2", "mouse:4"]);
    expect(result.trace.filter((line) => line.startsWith("logical:"))).toEqual([]);
  });

  it("dispatches a complete physical chord using the target thread HKL, then runs the next step", async () => {
    const result = await runNative([
      { op: "physicalChord", keys: ["ControlLeft", "ShiftLeft", "KeyK"], hkl: "0000000004070407", nofocus: true },
      { op: "chord", keys: ["ctrl+b"], nofocus: true },
    ]);
    expect(result.status, JSON.stringify(result)).toBe(0);
    expect(result.log.join(" ")).toContain("physicalChord success");
    const hklObservations = result.trace.filter((line) => line.startsWith("observe:hkl:"));
    expect(hklObservations.length).toBeGreaterThan(0);
    expect(hklObservations.every((line) => line.endsWith(":7:67568647"))).toBe(true);
    expect(result.trace.filter((line) => line.startsWith("scan:"))).toEqual([
      "scan:29:False:False", "scan:42:False:False", "scan:37:False:False",
      "scan:37:True:False", "scan:42:True:False", "scan:29:True:False",
    ]);
    expect(result.trace.filter((line) => line.startsWith("logical:"))).toEqual([
      "logical:17:0", "logical:66:0", "logical:66:2", "logical:17:2",
    ]);
  });

  it("rejects the driver thread HKL before physical input", async () => {
    const result = await runNative([
      { op: "physicalChord", keys: ["AltRight", "KeyQ"], hkl: "0000000004090409", nofocus: true, onError: "continue" },
      { op: "chord", keys: ["ctrl+b"], nofocus: true },
    ]);
    expect(result.status, JSON.stringify(result)).toBe(1);
    expect(result.log.join(" ")).toMatch(/PHYSICAL_HKL_MISMATCH.*ABORTED at step 1/);
    expect(result.trace.filter((line) => line.startsWith("scan:") || line.startsWith("logical:"))).toEqual([]);
  });

  it("executes the production physical loop and aborts a short SendInput before a sentinel", async () => {
    const result = await runNative([
      { op: "physicalChord", keys: ["ControlLeft", "ShiftLeft", "KeyK"], hkl: "0000000004070407", nofocus: true, onError: "continue" },
      { op: "chord", keys: ["ctrl+b"], nofocus: true },
    ], { shortSendAt: 3 });
    expect(result.status, JSON.stringify(result)).toBe(1);
    expect(result.log.join(" ")).toMatch(/PHYSICAL_SEND_SHORT.*ABORTED at step 1/);
    expect(result.trace.filter((line) => line.startsWith("scan:"))).toEqual([
      "scan:29:False:False", "scan:42:False:False", "scan:37:False:False",
      "scan:42:True:False", "scan:29:True:False",
    ]);
    expect(result.trace.filter((line) => line.startsWith("logical:"))).toEqual([]);
  });

  it.each([1, 2, 4, 5, 6])("aborts when physical send %i reports a short count", async (position) => {
    const result = await runNative([
      { op: "physicalChord", keys: ["ControlLeft", "ShiftLeft", "KeyK"], hkl: "0000000004070407", nofocus: true, onError: "continue" },
      { op: "chord", keys: ["ctrl+b"], nofocus: true },
    ], { shortSendAt: position });
    expect(result.status, JSON.stringify(result)).toBe(1);
    expect(result.log.join(" ")).toMatch(/PHYSICAL_SEND_SHORT.*ABORTED at step 1/);
    expect(result.trace.filter((line) => line.startsWith("logical:"))).toEqual([]);
    expect(result.trace.filter((line) => line.startsWith("scan:")).length).toBeGreaterThanOrEqual(position);
  }, 30_000);

  it("attempts every held modifier release even when an earlier cleanup release throws", async () => {
    const result = await runNative([
      { op: "physicalChord", keys: ["ControlLeft", "ShiftLeft", "KeyK"], hkl: "0000000004070407", nofocus: true, onError: "continue" },
      { op: "chord", keys: ["ctrl+b"], nofocus: true },
    ], { shortSendAt: 3, throwReleaseAt: 4 });
    expect(result.status, JSON.stringify(result)).toBe(1);
    expect(result.log.join(" ")).toMatch(/PHYSICAL_RELEASE_FAILED.*ABORTED at step 1/);
    expect(result.trace.filter((line) => line.startsWith("scan:")).slice(-2)).toEqual([
      "scan:42:True:False", "scan:29:True:False",
    ]);
    expect(result.trace.filter((line) => line.startsWith("logical:"))).toEqual([]);
  });

  it.each([
    ["process", { wrongExeAt: 2 }],
    ["HWND owner", { threadChangeAt: 2 }],
    ["foreground", { foregroundChangeAt: 2 }],
  ])("rejects a changed %s after resolution before input", async (_name, scenario) => {
    const result = await runNative([
      { op: "chord", keys: ["ctrl+a"], nofocus: true, onError: "continue" },
      { op: "chord", keys: ["ctrl+b"], nofocus: true },
    ], scenario);
    expect(result.status, JSON.stringify(result)).toBe(1);
    expect(result.log.join(" ")).toMatch(/IDENTITY_.*ABORTED at step 1/);
    expect(result.trace.filter((line) => line.startsWith("logical:"))).toEqual([]);
  });

  it("rejects a target-thread HKL change before physical injection", async () => {
    const result = await runNative([
      { op: "physicalChord", keys: ["AltRight", "KeyQ"], hkl: "0000000004070407", nofocus: true, onError: "continue" },
      { op: "chord", keys: ["ctrl+b"], nofocus: true },
    ], { hklChangeAt: 2 });
    expect(result.status, JSON.stringify(result)).toBe(1);
    expect(result.log.join(" ")).toMatch(/PHYSICAL_HKL_MISMATCH.*ABORTED at step 1/);
    expect(result.trace.filter((line) => line.startsWith("scan:") || line.startsWith("logical:"))).toEqual([]);
  });

  it.each([1, 2, 3, 4, 5, 6])("aborts and attempts reverse cleanup after physical send exception %i", async (position) => {
    const result = await runNative([
      { op: "physicalChord", keys: ["ControlLeft", "ShiftLeft", "KeyK"], hkl: "0000000004070407", nofocus: true, onError: "continue" },
      { op: "chord", keys: ["ctrl+b"], nofocus: true },
    ], { throwSendAt: position });
    expect(result.status, JSON.stringify(result)).toBe(1);
    expect(result.log.join(" ")).toContain("ABORTED at step 1");
    expect(result.trace.filter((line) => line.startsWith("logical:"))).toEqual([]);
    const scans = result.trace.filter((line) => line.startsWith("scan:"));
    expect(scans.at(-1)).toBe("scan:29:True:False");
  }, 30_000);

  it.each([1, 3])("balances the mouse after menuat click-down %i invalidates identity", async (downAt) => {
    const result = await runNative([
      { op: "menuat", bar: [100, 100], item: [150, 150], onError: "continue" },
      { op: "chord", keys: ["ctrl+b"], nofocus: true },
    ], { focusChangesAfterMouseDownAt: downAt });
    expect(result.status, JSON.stringify(result)).toBe(1);
    expect(result.trace.filter((line) => line.startsWith("mouse:"))).toEqual(
      downAt === 1 ? ["mouse:2", "mouse:4"] : ["mouse:2", "mouse:4", "mouse:2", "mouse:4"],
    );
    expect(result.trace.filter((line) => line === "logical:66:0")).toEqual([]);
  });
});
