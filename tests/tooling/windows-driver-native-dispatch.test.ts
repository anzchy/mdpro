// @vitest-environment node
import { writeFileSync } from "node:fs";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { startFakeCdp, type FakePage } from "../support/fakeCdp";
import { runNative, type NativeScenario } from "./windows-driver-native-harness";

// Each case starts PowerShell and several Node helpers; CI startup can exceed Vitest's 5 s default.
vi.setConfig({ testTimeout: 30_000 });

const focusOps = [
  { op: "focus" },
  { op: "menuat", bar: [100, 100], item: [150, 150] },
  { op: "menuclick", path: ["File", "Save"] },
  { op: "chord", keys: ["ctrl+a"] },
  { op: "physicalChord", keys: ["AltRight", "KeyQ"], hkl: "0000000004070407" },
] as const;

async function runLabelledFocus(op: object, scenario: NativeScenario) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mdpro-focus-recipient-"));
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
    return await runNative([
      { ...op, window: "A", _identity: [
        { label: "A", pageId: "p1", rect: [0, 0, 800, 600] },
        { label: "B", pageId: "p2", rect: [900, 0, 1700, 600] },
      ], onError: "continue" },
      { op: "chord", window: "A", _identity: [
        { label: "A", pageId: "p1", rect: [0, 0, 800, 600] },
        { label: "B", pageId: "p2", rect: [900, 0, 1700, 600] },
      ], keys: ["ctrl+b"], nofocus: true },
    ], { secondMdpro: true, ...scenario }, { cdpPort: server.port, titlePath });
  } finally { await server.close(); }
}

describe("B7 post-cap focus recipient isolation", () => {
  it.each(focusOps)("refuses $op when B stays foreground without key input to B", async (op) => {
    const result = await runLabelledFocus(op, { initialForeground: 202, refuseFocus: true });
    expect(result.status, JSON.stringify(result)).toBe(1);
    expect(result.log.join(" ")).toContain("IDENTITY_FOCUS_REFUSED");
    expect(result.log.join(" ")).toContain("ABORTED at step 1");
    expect(result.trace.filter((line) => line.startsWith("key-target:B:"))).toEqual([]);
    expect(result.trace).not.toContain("effect:B");
    expect(result.trace).not.toContain("logical:66:0");
    expect(result.trace.filter((line) => line.startsWith("mouse:") || line.startsWith("scan:"))).toEqual([]);
  });

  it.each(focusOps)("activates A for $op without a synthetic Alt tap", async (op) => {
    const result = await runLabelledFocus(op, { initialForeground: 202 });
    expect(result.status, JSON.stringify(result)).toBe(0);
    expect(result.log.join(" ")).not.toContain("ABORTED");
    expect(result.trace.filter((line) => line.startsWith("focus:"))).toEqual([]);
    expect(result.trace.filter((line) => line.startsWith("key-target:B:"))).toEqual([]);
    expect(result.trace).not.toContain("effect:B");
    expect(result.trace).toContain("logical:66:0");
  });

  it.each(focusOps)("aborts $op if B regains foreground during focus wait", async (op) => {
    const result = await runLabelledFocus(op, { initialForeground: 202, driftDuringFocusWait: true });
    expect(result.status, JSON.stringify(result)).toBe(1);
    expect(result.log.join(" ")).toContain("IDENTITY_FOCUS_REFUSED");
    expect(result.log.join(" ")).toContain("ABORTED at step 1");
    expect(result.trace.filter((line) => line.startsWith("key-target:B:"))).toEqual([]);
    expect(result.trace).not.toContain("effect:B");
    expect(result.trace).not.toContain("logical:66:0");
    expect(result.trace.filter((line) => line.startsWith("mouse:") || line.startsWith("scan:"))).toEqual([]);
  });

  it.each(["refuseFocus", "ignoreFocus"] as const)("rejects %s even if the activation return is misleading", async (failure) => {
    const result = await runLabelledFocus({ op: "focus" }, { initialForeground: 202, [failure]: true });
    expect(result.status, JSON.stringify(result)).toBe(1);
    expect(result.log.join(" ")).toContain("IDENTITY_FOCUS_REFUSED");
    expect(result.trace.filter((line) => line.startsWith("key-target:B:"))).toEqual([]);
    expect(result.trace).not.toContain("logical:66:0");
  });

  it("skips activation and Alt when A is already foreground", async () => {
    const result = await runLabelledFocus({ op: "focus" }, { initialForeground: 101 });
    expect(result.status, JSON.stringify(result)).toBe(0);
    expect(result.trace.filter((line) => line.startsWith("focus:") || line.startsWith("focus-request:"))).toEqual([]);
    expect(result.trace).toContain("logical:66:0");
  });

  it.each(focusOps)("preserves the $op effect when A is already foreground", async (op) => {
    const result = await runLabelledFocus(op, { initialForeground: 101 });
    expect(result.status, JSON.stringify(result)).toBe(0);
    expect(result.trace.filter((line) => line.startsWith("focus:") || line.startsWith("focus-request:"))).toEqual([]);
    expect(result.trace.filter((line) => line.startsWith("key-target:B:"))).toEqual([]);
    if (op.op === "focus") expect(result.log).toContain("focused");
    if (op.op === "menuat") expect(result.trace).toContain("effect:A");
    if (op.op === "menuclick") expect(result.log.join(" ")).toContain("click 'Save'");
    if (op.op === "chord") expect(result.trace).toContain("logical:65:0");
    if (op.op === "physicalChord") expect(result.trace).toContain("scan:56:False:True");
  });

  it("refuses an unlabelled sole mdpro window when another application owns foreground", async () => {
    const result = await runNative([
      { op: "focus", onError: "continue" },
      { op: "chord", keys: ["ctrl+b"], nofocus: true },
    ], { initialForeground: 202, refuseFocus: true });
    expect(result.status, JSON.stringify(result)).toBe(1);
    expect(result.log.join(" ")).toContain("IDENTITY_FOCUS_REFUSED");
    expect(result.trace.filter((line) => line.startsWith("key-target:B:"))).toEqual([]);
    expect(result.trace).not.toContain("logical:66:0");
  });
});

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

  it.each([
    ["bar over B", [950, 100], [150, 150], {}],
    ["item over B", [100, 100], [950, 150], {}],
    ["item in B popup", [100, 100], [150, 150], { popupAtItem: "B" as const }],
  ])("refuses menuat %s before any down reaches B", async (_name, bar, item, scenario) => {
    const result = await runNative([
      { op: "menuat", bar, item, onError: "continue" },
      { op: "chord", keys: ["ctrl+b"], nofocus: true },
    ], scenario);
    expect(result.status, JSON.stringify(result)).toBe(1);
    expect(result.log.join(" ")).toMatch(/IDENTITY_POINT_OUTSIDE.*ABORTED at step 1/);
    expect(result.trace).not.toContain("mouse-target:B:2");
    expect(result.trace).not.toContain("effect:B");
    expect(result.trace.filter((line) => line.startsWith("logical:"))).toEqual([]);
  });

  it("accepts a menu item popup belonging to A's thread", async () => {
    const result = await runNative([{ op: "menuat", bar: [100, 100], item: [150, 150] }], { popupAtItem: "A" });
    expect(result.status, JSON.stringify(result)).toBe(0);
    expect(result.trace.filter((line) => line === "mouse:2")).toHaveLength(2);
    expect(result.trace).not.toContain("effect:B");
  });

  it.each([
    ["B", 950, 100],
    ["another A control", 150, 100],
  ])("refuses clickat cursor drift to %s after the wait", async (_name, driftX, driftY) => {
    const result = await runNative([
      { op: "clickat", x: 100, y: 100, nofocus: true, onError: "continue" },
      { op: "chord", keys: ["ctrl+b"], nofocus: true },
    ], { driftDuringWait: true, driftX, driftY });
    expect(result.status, JSON.stringify(result)).toBe(1);
    expect(result.trace.filter((line) => line.startsWith("mouse:"))).toEqual([]);
    expect(result.trace.filter((line) => line.startsWith("logical:"))).toEqual([]);
    expect(result.trace).not.toContain("effect:B");
  });

  it.each([
    ["cursor read", { failCursorRead: true }],
    ["hit read", { nullHit: true }],
    ["root read", { nullRoot: true }],
  ])("refuses clickat after a failed %s", async (_name, scenario) => {
    const result = await runNative([
      { op: "clickat", x: 100, y: 100, nofocus: true, onError: "continue" },
      { op: "chord", keys: ["ctrl+b"], nofocus: true },
    ], scenario);
    expect(result.status, JSON.stringify(result)).toBe(1);
    expect(result.trace.filter((line) => line.startsWith("mouse:"))).toEqual([]);
    expect(result.trace.filter((line) => line.startsWith("logical:"))).toEqual([]);
  });

  it("releases a held mouse over A after a post-down focus change", async () => {
    const result = await runNative([
      { op: "clickat", x: 100, y: 100, nofocus: true, onError: "continue" },
      { op: "chord", keys: ["ctrl+b"], nofocus: true },
    ], { focusChangesAfterMouseDown: true });
    expect(result.status, JSON.stringify(result)).toBe(1);
    expect(result.trace.filter((line) => line.startsWith("mouse-target:"))).toEqual([
      "mouse-target:A:2", "mouse-target:A:4",
    ]);
    expect(result.trace).not.toContain("effect:B");
    expect(result.trace.filter((line) => line.startsWith("logical:"))).toEqual([]);
  });

  it("refuses a B menu popup even when it shares A's UI thread", async () => {
    const result = await runNative([
      { op: "menuat", bar: [100, 100], item: [150, 150], onError: "continue" },
      { op: "chord", keys: ["ctrl+b"], nofocus: true },
    ], { popupAtItem: "B", popupBSharedThread: true });
    expect(result.status, JSON.stringify(result)).toBe(1);
    expect(result.trace).not.toContain("mouse-target:B:2");
    expect(result.trace).not.toContain("effect:B");
    expect(result.trace).not.toContain("logical:66:0");
  });

  it("does not release over B when B covers A after a valid mouse down", async () => {
    const result = await runNative([
      { op: "clickat", x: 100, y: 100, nofocus: true, onError: "continue" },
      { op: "chord", keys: ["ctrl+b"], nofocus: true },
    ], { overlayAfterMouseDown: true });
    expect(result.status, JSON.stringify(result)).toBe(1);
    expect(result.trace).not.toContain("mouse-target:B:4");
    expect(result.trace).not.toContain("effect:B");
    expect(result.trace).not.toContain("logical:66:0");
  });

  it.each([
    ["bar", { overlayAtA: true }],
    ["item", { popupAtItem: "B" as const }],
  ])("guards menuclick %s from a B recipient", async (_name, scenario) => {
    const result = await runNative([
      { op: "menuclick", path: ["File", "Save"], onError: "continue" },
      { op: "chord", keys: ["ctrl+b"], nofocus: true },
    ], scenario);
    expect(result.status, JSON.stringify(result)).toBe(1);
    expect(result.trace).not.toContain("mouse-target:B:2");
    expect(result.trace).not.toContain("effect:B");
    expect(result.trace).not.toContain("logical:66:0");
  });

  it("completes a valid menuclick bar and A popup path", async () => {
    const result = await runNative([{ op: "menuclick", path: ["File", "Save"] }]);
    expect(result.status, JSON.stringify(result)).toBe(0);
    expect(result.trace.filter((line) => line === "mouse:2")).toHaveLength(2);
    expect(result.trace).not.toContain("effect:B");
  });

  it("rejects same-window drift at the menu item after a valid bar click", async () => {
    const result = await runNative([
      { op: "menuat", bar: [100, 100], item: [150, 150], onError: "continue" },
      { op: "chord", keys: ["ctrl+b"], nofocus: true },
    ], { driftDuringWait: true, driftAtSleep: 3, driftX: 160, driftY: 150 });
    expect(result.status, JSON.stringify(result)).toBe(1);
    expect(result.trace.filter((line) => line === "mouse:2")).toHaveLength(1);
    expect(result.trace).not.toContain("logical:66:0");
  });

  it("does not release into B if A becomes covered during cleanup", async () => {
    const result = await runNative([
      { op: "clickat", x: 100, y: 100, nofocus: true, onError: "continue" },
      { op: "chord", keys: ["ctrl+b"], nofocus: true },
    ], { focusChangesAfterMouseDown: true, overlayAfterMouseDown: true });
    expect(result.status, JSON.stringify(result)).toBe(1);
    expect(result.log.join(" ")).toContain("IDENTITY_MOUSE_RELEASE_FAILED");
    expect(result.trace).not.toContain("mouse-target:B:4");
    expect(result.trace).not.toContain("logical:66:0");
  });

  it("binds label A among two mdpro windows but refuses menuat coordinates over B", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mdpro-labelled-hit-"));
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
        { op: "menuat", window: "A", _identity: [
          { label: "A", pageId: "p1", rect: [0, 0, 800, 600] },
          { label: "B", pageId: "p2", rect: [900, 0, 1700, 600] },
        ], bar: [950, 100], item: [150, 150], onError: "continue" },
        { op: "chord", keys: ["ctrl+b"], nofocus: true },
      ], { secondMdpro: true }, { cdpPort: server.port, titlePath });
      expect(result.status, JSON.stringify(result)).toBe(1);
      expect(result.log.join(" ")).toContain("IDENTITY_POINT_OUTSIDE");
      expect(result.trace).not.toContain("mouse-target:B:2");
      expect(result.trace).not.toContain("effect:B");
      expect(result.trace).not.toContain("logical:66:0");
      expect(await fs.readFile(titlePath, "utf8")).toBe("mdpro");
    } finally { await server.close(); }
  });

  it("rejects a hit changed during the final identity helper", async () => {
    const result = await runNative([
      { op: "clickat", x: 100, y: 100, nofocus: true, onError: "continue" },
      { op: "chord", keys: ["ctrl+b"], nofocus: true },
    ], { overlayAtRectCall: 5 });
    expect(result.status, JSON.stringify(result)).toBe(1);
    expect(result.trace.filter((line) => line.startsWith("mouse:"))).toEqual([]);
    expect(result.trace).not.toContain("logical:66:0");
  });

  it("refuses a popup when its thread observation fails", async () => {
    const result = await runNative([
      { op: "menuat", bar: [100, 100], item: [150, 150], onError: "continue" },
      { op: "chord", keys: ["ctrl+b"], nofocus: true },
    ], { popupAtItem: "A", failPopupThread: true });
    expect(result.status, JSON.stringify(result)).toBe(1);
    expect(result.trace.filter((line) => line === "mouse:2")).toHaveLength(1);
    expect(result.trace).not.toContain("logical:66:0");
  });

  it("reports a failed safe mouse relocation without an up over B", async () => {
    const result = await runNative([
      { op: "clickat", x: 100, y: 100, nofocus: true, onError: "continue" },
      { op: "chord", keys: ["ctrl+b"], nofocus: true },
    ], { focusChangesAfterMouseDown: true, failSetCursorAt: 2 });
    expect(result.status, JSON.stringify(result)).toBe(1);
    expect(result.log.join(" ")).toContain("IDENTITY_MOUSE_RELEASE_FAILED");
    expect(result.trace).not.toContain("mouse-target:B:4");
    expect(result.trace).not.toContain("logical:66:0");
  });

  it("rejects a right click into B covering a point inside A's rectangle", async () => {
    const result = await runNative([
      { op: "clickat", x: 100, y: 100, right: true, nofocus: true, onError: "continue" },
      { op: "chord", keys: ["ctrl+b"], nofocus: true },
    ], { overlayAtA: true });
    expect(result.status, JSON.stringify(result)).toBe(1);
    expect(result.trace.filter((line) => line.startsWith("mouse:"))).toEqual([]);
    expect(result.trace).not.toContain("logical:66:0");
  });

  it("does not release into a replacement that reuses A's HWND after mouse down", async () => {
    const result = await runNative([
      { op: "clickat", x: 100, y: 100, nofocus: true, onError: "continue" },
      { op: "chord", keys: ["ctrl+b"], nofocus: true },
    ], { staleAfterMouseDown: true });
    expect(result.status, JSON.stringify(result)).toBe(1);
    expect(result.log.join(" ")).toContain("IDENTITY_MOUSE_RELEASE_FAILED");
    expect(result.trace).not.toContain("mouse-target:B:4");
    expect(result.trace).not.toContain("logical:66:0");
  });

  it("relocates a held mouse from B's cursor position before releasing over A", async () => {
    const result = await runNative([
      { op: "clickat", x: 100, y: 100, nofocus: true, onError: "continue" },
      { op: "chord", keys: ["ctrl+b"], nofocus: true },
    ], { driftAfterMouseDownToB: true });
    expect(result.status, JSON.stringify(result)).toBe(1);
    expect(result.trace.filter((line) => line.startsWith("mouse-target:"))).toEqual([
      "mouse-target:A:2", "mouse-target:A:4",
    ]);
    expect(result.trace).not.toContain("effect:B");
    expect(result.trace).not.toContain("logical:66:0");
  });

  it("rejects a changed hit at the menu item's final observation", async () => {
    const result = await runNative([
      { op: "menuat", bar: [100, 100], item: [150, 150], onError: "continue" },
      { op: "chord", keys: ["ctrl+b"], nofocus: true },
    ], { hitChangeAt: 3 });
    expect(result.status, JSON.stringify(result)).toBe(1);
    expect(result.trace.filter((line) => line === "mouse:2")).toHaveLength(1);
    expect(result.trace).not.toContain("mouse-target:B:2");
    expect(result.trace).not.toContain("logical:66:0");
  });

  it("retains the raw Alt key trace for logical chords", async () => {
    const result = await runNative([{ op: "chord", keys: ["alt+a"], nofocus: true }]);
    expect(result.status, JSON.stringify(result)).toBe(0);
    expect(result.trace.filter((line) => line.startsWith("key:"))).toEqual([
      "key:18:0", "key:65:0", "key:65:2", "key:18:2",
    ]);
  });
});
