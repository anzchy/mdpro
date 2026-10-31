// @vitest-environment node
/**
 * D336 F7 Mac transport: `ui.sh` carries the receipt route. The issuing step
 * (`dialogReceipt` with a label) needs the CDP identity read, like any labelled step, and goes
 * to Windows in one non-retriable call. The consuming step (`filedialog` with `receipt`) is
 * native-only: no identity read and no `_identity`, so a dead parent CDP cannot block it. A lost
 * issue response is never replayed, so no second receipt and no guessed token.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makeFakeSsh, type FakeSsh, type SshReply } from "../support/fakeSsh";

const UI = path.resolve(__dirname, "../../.agents/skills/remote-windows-device-test/scripts/mac/ui.sh");
const records = [{ label: "A", rect: [0, 0, 800, 600] }, { label: "B", rect: [900, 0, 1700, 600] }];
const token = "c".repeat(64);
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
const sentSteps = (call: string) => {
  const encoded = /-StepsB64 ([A-Za-z0-9+/=]+)/.exec(call)?.[1];
  expect(encoded, call).toBeTruthy();
  return JSON.parse(Buffer.from(encoded!, "base64").toString("utf8"));
};

describe("D336 F7 the Mac wrapper carries the receipt route", () => {
  it("sends a labelled dialogReceipt after one identity read, with the records, in one native call", async () => {
    const result = await runUi(
      [{ execute: true, stdout: JSON.stringify(records) + "\r\n" }, { execute: true, stdout: log(["receipt " + token]) }],
      [{ op: "dialogReceipt", window: "A" }],
    );
    expect(result.status, result.stderr).toBe(0);
    const calls = result.fake.executed();
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain("cdp.mjs identity-native");
    expect(sentSteps(calls[1])).toEqual([{ op: "dialogReceipt", window: "A", _identity: records }]);
    expect(result.stdout).toContain("receipt " + token);
  });

  it("sends a receipt consumer with no identity read and no _identity, label kept for the native check", async () => {
    const result = await runUi(
      [{ execute: true, stdout: log(["receipt consumed owner=101"]) }],
      [{ op: "filedialog", window: "A", receipt: token, path: "C:\\scratch\\a.md" }],
    );
    expect(result.status, result.stderr).toBe(0);
    const calls = result.fake.executed();
    expect(calls).toHaveLength(1);
    expect(calls.filter((call) => call.includes("cdp.mjs"))).toEqual([]);
    expect(sentSteps(calls[0])).toEqual([{ op: "filedialog", window: "A", receipt: token, path: "C:\\scratch\\a.md" }]);
  });

  it("never replays an issue whose response was lost, so no second receipt is minted", async () => {
    const result = await runUi(
      [{ execute: true, stdout: JSON.stringify(records) + "\r\n" }, { execute: true, exit: 255 }, { execute: true, stdout: log(["receipt " + token]) }],
      [{ op: "dialogReceipt", window: "A" }],
    );
    expect(result.status).toBe(3);
    const calls = result.fake.executed();
    expect(calls.filter((call) => call.includes("ui-run.ps1"))).toHaveLength(1);
    expect(sentSteps(calls[1])[0].op).toBe("dialogReceipt");
    expect(result.stdout).not.toMatch(/receipt [a-f0-9]{64}/);
  });

  it("still refuses a caller-supplied _identity on a receipt step", async () => {
    const result = await runUi([{ execute: true, stdout: log(["mutated"]) }], [{ op: "dialogReceipt", window: "A", _identity: records }]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("UI_STEPS_INVALID");
    expect(result.fake.executed()).toEqual([]);
  });
});
