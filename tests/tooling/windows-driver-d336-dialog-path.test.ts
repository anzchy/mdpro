// @vitest-environment node
/**
 * D336 F3: path and control boundaries. A dialog path is an absolute drive or UNC path of 1 to 259
 * UTF-16 code units with no control character; CJK, spaces and surrogate pairs pass losslessly.
 * Every refusal leaves the control untouched and sends no key. Zero or two filename controls in
 * A's dialog refuse the same way. Production ui.ps1 under pwsh with Win32 doubles only.
 */
import { describe, expect, it, vi } from "vitest";
import { effects, fileDialog, identity, runDialog } from "./windows-driver-native-dialog-harness";

vi.setConfig({ testTimeout: 30_000 });

const bind = { op: "menuinfo", window: "A", _identity: identity };
const dialogEffects = (trace: string[]) => effects(trace).filter((line) => !line.startsWith("key-hwnd:101:"));
const run = (step: object, dialogs = [fileDialog(602, 202), fileDialog(501, 101)]) =>
  runDialog([bind, { op: "filedialog", window: "A", _identity: identity, ...step }], { dialogs, dialogForeground: 501 });
// Pads with CJK to an exact UTF-16 length; the surrogate pair counts as two units but one code point.
const sized = (units: number) => {
  const head = "C:\\audit\\测试 😀";
  return head + "文".repeat(units - head.length - 3) + ".md";
};

describe("D336 F3 dialog path and control boundaries", () => {
  it.each([
    ["259 UTF-16 units with CJK, a space and a surrogate pair", sized(259)],
    ["a UNC path", "\\\\server\\share\\测试 a.md"],
  ])("writes %s losslessly and submits", async (_name, path) => {
    expect(path.length).toBeLessThanOrEqual(259);
    const result = await run({ path });
    expect(result.status, result.log.join("\n")).toBe(0);
    expect(dialogEffects(result.trace)).toEqual([`dialog-write:5012:12:${path}`, "key-hwnd:501:13:0", "key-hwnd:501:13:2", "dialog-submit:501"]);
  });

  it.each([
    ["260 UTF-16 units (259 code points)", sized(260)],
    ["an empty path", ""],
    ["a relative path", "audit\\a.md"],
    ["a drive-relative path", "C:a.md"],
    ["a Mac-style path", "/c/audit/a.md"],
    ["an embedded NUL", "C:\\audit\\a\u0000b.md"],
    ["a control character", "C:\\audit\\a\u0007b.md"],
    ["a tab", "C:\\audit\\a\tb.md"],
    ["a number", 42],
  ])("refuses %s before any write or key", async (_name, path) => {
    if (typeof path === "string" && path.startsWith("C:\\audit\\测试")) expect([...path].length).toBe(259);
    const result = await run({ path });
    expect(result.status).toBe(1);
    expect(result.log.join("\n")).toContain("UI_DIALOG_PATH_INVALID");
    expect(dialogEffects(result.trace)).toEqual([]);
    expect(result.outcome).toMatchObject({ status: "failed", inputOutcome: "none" });
  });

  it.each([
    ["no filename control", { controls: [{ hwnd: 5011, className: "ComboBox", id: 1148 }] }, "IDENTITY_DIALOG_CONTROL_NOT_FOUND"],
    ["two filename controls", { controls: [...fileDialog(501, 101).controls, { hwnd: 5014, className: "Edit", id: 1152 }] }, "IDENTITY_DIALOG_CONTROL_AMBIGUOUS"],
  ])("refuses A's dialog with %s, with no write or key", async (_name, extra, error) => {
    const result = await run({ path: "C:\\audit\\a.md" }, [fileDialog(602, 202), fileDialog(501, 101, extra)]);
    expect(result.status).toBe(1);
    expect(result.log.join("\n")).toContain(error);
    expect(dialogEffects(result.trace)).toEqual([]);
  });
});
