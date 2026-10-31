// @vitest-environment node
/**
 * D336 F5: a resolved dialog and its filename control are pinned to their window lifetime, not
 * to their numeric HWND. A dialog or control destroyed and re-created under the same HWND, so
 * that every numeric observation still matches, stops the run: before the write it writes
 * nothing, after the write it reports a partial outcome and sends no Enter. A second eligible
 * dialog after the write stops the same way. Dismissal is the end of the pinned lifetime, so a
 * same-HWND successor does not hold the run open. A live dialog keeps no pin after the run.
 * Production ui.ps1 under pwsh with Win32 doubles only.
 */
import { describe, expect, it, vi } from "vitest";
import { effects, fileDialog, identity, runDialog } from "./windows-driver-native-dialog-harness";

vi.setConfig({ testTimeout: 30_000 });

const PATH = "C:\\audit\\a.md";
const bind = { op: "menuinfo", window: "A", _identity: identity };
const dialogEffects = (trace: string[]) => effects(trace).filter((line) => !line.startsWith("key-hwnd:101:"));
const run = (step: object, extra: object = {}) =>
  runDialog([bind, { op: "filedialog", window: "A", _identity: identity, ...step }],
    { dialogs: [fileDialog(602, 202), fileDialog(501, 101)], dialogForeground: 501, ...extra });
const pinsOf = (trace: string[], kind: "pin" | "unpin") =>
  trace.filter((line) => line.startsWith(`dialog-${kind}:`)).map((line) => line.split(":")[1]).sort();

describe("D336 F5 dialog and control lifetime", () => {
  it("pins A's dialog and filename control, and leaves no pin on a dialog that stays alive", async () => {
    const result = await run({ path: PATH }, { dialogForeground: 602 });
    expect(result.status).toBe(1);
    expect(pinsOf(result.trace, "pin")).toEqual(["501", "5012"]);
    expect(pinsOf(result.trace, "unpin")).toEqual(["501", "5012"]);
  });

  it.each([
    ["A's dialog", 501],
    ["A's filename control", 5012],
  ])("%s replaced under the same HWND before the write refuses with no write or key", async (_name, hwnd) => {
    for (const step of [{ path: PATH }, { cancel: true }]) {
      const result = await run(step, { dialogReplace: "after-pin", dialogReplaceHwnd: hwnd });
      expect(result.trace).toContain(`dialog-replaced:${hwnd}`);
      expect(result.status).toBe(1);
      expect(result.log.join("\n")).toContain("IDENTITY_DIALOG_LIFETIME");
      expect(dialogEffects(result.trace)).toEqual([]);
      expect(result.outcome).toMatchObject({ status: "failed", inputOutcome: "none", heldInput: "released" });
    }
  });

  it.each([
    ["A's dialog", 501],
    ["A's filename control", 5012],
  ])("%s replaced under the same HWND after the write stops before Enter, partial", async (_name, hwnd) => {
    const result = await run({ path: PATH }, { dialogReplace: "after-write", dialogReplaceHwnd: hwnd });
    expect(result.status).toBe(1);
    expect(result.log.join("\n")).toContain("IDENTITY_DIALOG_LIFETIME");
    expect(dialogEffects(result.trace)).toEqual([`dialog-write:5012:12:${PATH}`]);
    expect(result.outcome).toMatchObject({ status: "failed", inputOutcome: "partial", heldInput: "released" });
  });

  it("a second eligible dialog that opens after the write stops before Enter, partial", async () => {
    const result = await run({ path: PATH }, { dialogAddAfterWrite: fileDialog(503, 101) });
    expect(result.status).toBe(1);
    expect(result.log.join("\n")).toContain("IDENTITY_DIALOG_AMBIGUOUS");
    expect(dialogEffects(result.trace)).toEqual([`dialog-write:5012:12:${PATH}`]);
    expect(result.outcome).toMatchObject({ status: "failed", inputOutcome: "partial" });
  });

  it("a same-HWND successor after Enter does not hold the run open: the pinned dialog is dismissed", async () => {
    const result = await run({ path: PATH }, { dialogReplace: "on-submit", dialogReplaceHwnd: 501 });
    expect(result.status, result.log.join("\n")).toBe(0);
    expect(result.log.join("\n")).toContain("dialog dismissed");
    expect(dialogEffects(result.trace)).toEqual([`dialog-write:5012:12:${PATH}`, "key-hwnd:501:13:0", "key-hwnd:501:13:2", "dialog-submit:501"]);
    expect(result.outcome).toMatchObject({ status: "completed", inputOutcome: "partial" });
  });
});
