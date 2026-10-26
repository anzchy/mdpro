// @vitest-environment node
import { spawn } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { makeFakeSsh, type FakeSsh, type SshReply } from "../support/fakeSsh";

const SKILL = path.resolve(__dirname, "../../.agents/skills/remote-windows-device-test");
const BINDING = path.join(SKILL, "scripts/windows/window-binding.mjs");
const UI = path.join(SKILL, "scripts/mac/ui.sh");
const boundsA = [0, 0, 800, 600];
const boundsB = [900, 0, 1700, 600];
const records = [{ label: "A", rect: boundsA }, { label: "B", rect: boundsB }];
const windows = [
  { hwnd: "101", pid: 11, rect: boundsA, visible: true, title: "B" },
  { hwnd: "202", pid: 11, rect: boundsB, visible: true, title: "A" },
];

const binding = await import(pathToFileURL(BINDING).href);
const resolve = (input: Record<string, unknown>) => binding.resolveWindow(input);
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

describe("B7DRV-WI-1 one-to-one physical binding", () => {
  it("rejects a pre-bind geometry swap unless the exact page-origin challenge remains on the same HWND", () => {
    const challenged = [
      { ...windows[0], title: "mdpro-test:nonce-A" },
      { ...windows[1], title: "mdpro-test:nonce-B" },
    ];
    expect(resolve({ label: "A", records, windows: challenged, challenge: "mdpro-test:nonce-A" })).toMatchObject({ hwnd: "101" });
    expect(() => resolve({ label: "A", records, windows, challenge: "mdpro-test:nonce-A" })).toThrow(/IDENTITY_CHALLENGE/);
    expect(() => resolve({ label: "A", records, windows: [
      { ...challenged[0], rect: boundsB }, { ...challenged[1], rect: boundsA },
    ], challenge: "mdpro-test:nonce-A" })).toThrow(/IDENTITY/);
    expect(() => resolve({ label: "A", records, windows: [
      { ...challenged[0], hwnd: "303" }, challenged[1],
    ], challenge: "mdpro-test:nonce-A", expected: { label: "A", hwnd: "101", pid: 11, rect: boundsA } })).toThrow(/IDENTITY/);
  });

  it("selects A and B by physical bounds rather than foreground or window title", () => {
    for (const foreground of ["101", "202"]) {
      expect(resolve({ label: "A", records, windows, foreground })).toMatchObject({ hwnd: "101", pid: 11, rect: boundsA });
      expect(resolve({ label: "B", records, windows, foreground })).toMatchObject({ hwnd: "202", pid: 11, rect: boundsB });
    }
  });

  it("rejects unknown/duplicate labels and indistinguishable rectangles", () => {
    expect(() => resolve({ label: "other", records, windows })).toThrow(/IDENTITY/);
    expect(() => resolve({ label: "A", records: [...records, records[0]], windows })).toThrow(/IDENTITY/);
    expect(() => resolve({ label: "A", records: [{ label: "A", rect: boundsA }, { label: "B", rect: boundsA }], windows })).toThrow(/IDENTITY/);
    expect(() => resolve({ label: "A", records, windows: [...windows, { ...windows[1], rect: boundsA }] })).toThrow(/IDENTITY/);
  });

  it("rejects changed, hidden, closed and recreated HWNDs without rebinding", () => {
    const expected = resolve({ label: "A", records, windows });
    expect(() => resolve({ label: "A", records, windows: [{ ...windows[0], rect: [1, 0, 801, 600] }, windows[1]], expected })).toThrow(/IDENTITY/);
    expect(() => resolve({ label: "A", records, windows: [windows[1]], expected })).toThrow(/IDENTITY/);
    expect(() => resolve({ label: "A", records, windows: [{ ...windows[0], visible: false }, windows[1]], expected })).toThrow(/IDENTITY/);
    expect(() => resolve({ label: "A", records, windows: [{ ...windows[0], hwnd: "303" }, windows[1]], expected })).toThrow(/IDENTITY/);
    expect(() => resolve({ label: "A", records, windows: [{ ...windows[0], pid: 12 }, windows[1]], expected })).toThrow(/IDENTITY/);
  });

  it("requires a label when two windows exist, keeps the sole-window path, and checks nofocus foreground", () => {
    expect(() => resolve({ records, windows, foreground: "101" })).toThrow(/IDENTITY/);
    expect(resolve({ records: [], windows: [windows[0]], foreground: "101" })).toMatchObject({ hwnd: "101" });
    expect(() => resolve({ records: [], windows: [] })).toThrow(/IDENTITY/);
    expect(() => resolve({ label: "A", records, windows, requireForeground: true, foreground: "202" })).toThrow(/IDENTITY/);
    expect(() => resolve({ records: [], windows: [windows[0]], requireForeground: true, foreground: "other-app" })).toThrow(/IDENTITY/);
  });
});

describe("B7DRV-WI-1 Mac transport", () => {
  it("reads identity before sending a single native run and carries the complete records", async () => {
    const result = await runUi(
      [{ execute: true, stdout: JSON.stringify(records) + "\r\n" }, { execute: true, stdout: log(["click 'Save'"]) }],
      [{ op: "menuclick", window: "A", path: ["File", "Save"] }],
    );
    expect(result.status, result.stderr).toBe(0);
    const calls = result.fake.executed();
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain("cdp.mjs identity");
    const encoded = /-StepsB64 ([A-Za-z0-9+/=]+)/.exec(calls[1])?.[1];
    expect(encoded).toBeTruthy();
    const sent = JSON.parse(Buffer.from(encoded!, "base64").toString("utf8"));
    expect(sent).toEqual([{ op: "menuclick", window: "A", path: ["File", "Save"], _identity: records }]);
  });

  it.each([1, 3, 5, 6])("blocks all native mutation after identity read exit %i", async (remote) => {
    const result = await runUi(
      [{ execute: true, remote, stdout: '{"error":"IDENTITY_READ_FAILED"}\r\n' }, { execute: true, stdout: log(["mutated"]) }],
      [{ op: "menuclick", window: "A", path: ["File", "Save"] }],
    );
    expect(result.status).not.toBe(0);
    expect(result.fake.executed().filter((call) => call.includes("ui-run.ps1"))).toEqual([]);
  });

  it("does not replay a native menu when SSH loses its outcome", async () => {
    const result = await runUi(
      [{ execute: true, stdout: JSON.stringify(records) + "\r\n" }, { execute: true, exit: 255 }],
      [{ op: "menuclick", window: "B", path: ["File", "Save"] }],
    );
    expect(result.status).toBe(3);
    expect(result.fake.executed().filter((call) => call.includes("ui-run.ps1"))).toHaveLength(1);
  });

  it("keeps the title challenge inside the one non-retriable native SSH call", async () => {
    const result = await runUi(
      [{ execute: true, stdout: JSON.stringify(records) + "\r\n" }, { execute: true, exit: 255 }, { execute: true, stdout: log(["retry would mutate"]) }],
      [{ op: "menuclick", window: "A", path: ["File", "Save"] }],
    );
    expect(result.status).toBe(3);
    const calls = result.fake.executed();
    expect(calls.filter((call) => call.includes("cdp.mjs identity-native"))).toHaveLength(1);
    expect(calls.filter((call) => call.includes("ui-run.ps1"))).toHaveLength(1);
    expect(calls.filter((call) => call.includes("cdp.mjs --window") && call.includes(" bind "))).toEqual([]);
  });

  it("uses the legacy sole-window transport without an identity read", async () => {
    const result = await runUi([{ execute: true, stdout: log(["focused"]) }], [{ op: "focus" }]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.fake.executed()).toHaveLength(1);
    expect(result.fake.executed()[0]).toContain("ui-run.ps1");
  });
});
