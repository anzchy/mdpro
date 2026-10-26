// @vitest-environment node
import { spawn } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { makeFakeSsh, type FakeSsh, type SshReply } from "../support/fakeSsh";

const SKILL = path.resolve(__dirname, "../../.agents/skills/remote-windows-device-test");
const PLANNER = path.join(SKILL, "scripts/windows/physical-chord.mjs");
const BINDING = path.join(SKILL, "scripts/windows/window-binding.mjs");
const UI = path.join(SKILL, "scripts/mac/ui.sh");
const HKL = "0000000004070407";
const EXE = "D:\\programs\\mdpro\\tauri-app.exe";
const planner = await import(pathToFileURL(PLANNER).href);
const binding = await import(pathToFileURL(BINDING).href);
const plan = (keys: string[], overrides: Record<string, unknown> = {}) => planner.planPhysicalChord({
  keys, expectedHkl: HKL, actualHkl: HKL, targetHwnd: "101", foregroundHwnd: "101", ...overrides,
});
const made: FakeSsh[] = [];
afterEach(() => made.splice(0).forEach((fake) => fake.cleanup()));

function runUi(script: SshReply[], steps: unknown): Promise<{ status: number | null; stdout: string; stderr: string; fake: FakeSsh }> {
  const fake = makeFakeSsh(script);
  made.push(fake);
  return new Promise((done) => {
    const child = spawn("bash", [UI, JSON.stringify(steps)], { env: fake.env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data) => (stdout += data));
    child.stderr.on("data", (data) => (stderr += data));
    child.on("close", (status) => done({ status, stdout, stderr, fake }));
  });
}
const log = (lines: string[]) => Buffer.from(JSON.stringify(lines)).toString("base64") + "\r\n";
const identity = [{ label: "A", rect: [0, 0, 800, 600] }];

describe("B7DRV-WI-2 physical scan-code plan", () => {
  it("holds right Alt extended through German physical Q and E, then releases in reverse", () => {
    for (const [key, scan] of [["KeyQ", 0x10], ["KeyE", 0x12]] as const) {
      expect(plan(["AltRight", key])).toEqual([
        { name: "AltRight", scan: 0x38, extended: true, up: false },
        { name: key, scan, extended: false, up: false },
        { name: key, scan, extended: false, up: true },
        { name: "AltRight", scan: 0x38, extended: true, up: true },
      ]);
    }
    expect(plan(["AltLeft", "KeyQ"])).toMatchObject([{ extended: false }, {}, {}, { extended: false }]);
  });

  it("keeps Shift+Digit7 and Ctrl+Shift+K/brackets in physical down/up order", () => {
    expect(plan(["ShiftLeft", "Digit7"])).toEqual([
      { name: "ShiftLeft", scan: 0x2a, extended: false, up: false },
      { name: "Digit7", scan: 0x08, extended: false, up: false },
      { name: "Digit7", scan: 0x08, extended: false, up: true },
      { name: "ShiftLeft", scan: 0x2a, extended: false, up: true },
    ]);
    for (const [key, scan] of [["KeyK", 0x25], ["BracketLeft", 0x1a], ["BracketRight", 0x1b]] as const) {
      expect(plan(["ControlLeft", "ShiftLeft", key]).map((event: { scan: number }) => event.scan)).toEqual([0x1d, 0x2a, scan, scan, 0x2a, 0x1d]);
    }
  });

  it("rejects unknown names, missing or mismatched target HKL, and wrong focus before planning", () => {
    expect(() => plan(["AltRight", "NotAKey"])).toThrow(/PHYSICAL_KEY_UNKNOWN/);
    expect(() => plan(["AltRight", "KeyQ"], { expectedHkl: "" })).toThrow(/PHYSICAL_HKL_REQUIRED/);
    expect(() => plan(["AltRight", "KeyQ"], { actualHkl: "0000000004090409" })).toThrow(/PHYSICAL_HKL_MISMATCH/);
    expect(() => plan(["AltRight", "KeyQ"], { foregroundHwnd: "202" })).toThrow(/PHYSICAL_FOCUS_MISMATCH/);
    expect(() => plan(["AltRight", "AltLeft"])).toThrow(/PHYSICAL_KEY_INVALID/);
  });

  it("releases every accepted physical chord in exact reverse order", () => {
    const modifiers = ["ControlLeft", "ControlRight", "ShiftLeft", "ShiftRight", "AltLeft", "AltRight", "MetaLeft", "MetaRight"];
    const mainKeys = ["KeyQ", "KeyE", "KeyK", "BracketLeft", "BracketRight", "Digit7"];
    for (const key of mainKeys) {
      for (let mask = 0; mask < 1 << modifiers.length; mask++) {
        const prefix = modifiers.filter((_, index) => mask & (1 << index)).slice(0, 4);
        if (prefix.length !== modifiers.filter((_, index) => mask & (1 << index)).length) continue;
        const events = plan([...prefix, key]);
        const down = events.slice(0, prefix.length + 1);
        expect(events.slice(down.length)).toEqual(down.toReversed().map((event: { name: string; scan: number; extended: boolean }) => ({ ...event, up: true })));
      }
    }
  });
});

describe("B7DRV-WI-2 process identity and Mac transport", () => {
  it("does not authorize an unrelated tauri-app executable merely because the rect matches", () => {
    const records = [{ label: "A", rect: [0, 0, 800, 600] }];
    const windows = [{ hwnd: "101", pid: 11, visible: true, rect: [0, 0, 800, 600], exe: "C:\\Other\\tauri-app.exe" }];
    expect(() => binding.resolveWindow({ label: "A", records, windows, expectedExe: EXE })).toThrow(/IDENTITY_PROCESS/);
    expect(binding.resolveWindow({ label: "A", records, windows: [{ ...windows[0], exe: EXE }], expectedExe: EXE })).toMatchObject({ hwnd: "101" });
  });

  it("passes one physicalChord through the labelled native transport and propagates an injection abort", async () => {
    const result = await runUi(
      [{ execute: true, stdout: JSON.stringify(identity) + "\r\n" }, { execute: true, remote: 1, stdout: log(["ERROR physicalChord: PHYSICAL_SEND_SHORT", "ABORTED at step 1"]) }],
      [{ op: "physicalChord", window: "A", keys: ["AltRight", "KeyQ"], hkl: HKL, nofocus: true }, { op: "wait", ms: 1 }],
    );
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("PHYSICAL_SEND_SHORT");
    expect(result.stdout).not.toContain("step 2 completed");
    const calls = result.fake.executed();
    expect(calls[0]).toContain("cdp.mjs identity");
    const uiCalls = calls.filter((call) => call.includes("ui-run.ps1"));
    expect(uiCalls).toHaveLength(1);
    const encoded = /-StepsB64 ([A-Za-z0-9+/=]+)/.exec(uiCalls[0])?.[1];
    expect(JSON.parse(Buffer.from(encoded!, "base64").toString("utf8"))[0]).toMatchObject({
      op: "physicalChord", keys: ["AltRight", "KeyQ"], hkl: HKL, _identity: identity,
    });
  });

  it("does not replay physical input when SSH loses its outcome", async () => {
    const result = await runUi(
      [{ execute: true, stdout: JSON.stringify(identity) + "\r\n" }, { execute: true, exit: 255 }],
      [{ op: "physicalChord", window: "A", keys: ["AltRight", "KeyE"], hkl: HKL }],
    );
    expect(result.status).toBe(3);
    expect(result.fake.executed().filter((call) => call.includes("ui-run.ps1"))).toHaveLength(1);
  });
});
