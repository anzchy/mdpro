// @vitest-environment node
/**
 * D336 F2: submit and cancel have distinct terminal effects. Submit writes A's filename control
 * once, sends one Enter and observes the dialog dismissed; cancel sends one Esc and never writes,
 * even when a path is supplied; a dialog that stays open is reported, not claimed. Cancel still
 * needs A's unique dialog. Production ui.ps1 under pwsh with Win32 doubles only.
 */
import { describe, expect, it, vi } from "vitest";
import { effects, fileDialog, identity, runDialog } from "./windows-driver-native-dialog-harness";

vi.setConfig({ testTimeout: 30_000 });

const bind = { op: "menuinfo", window: "A", _identity: identity };
const dialogEffects = (trace: string[]) => effects(trace).filter((line) => !line.startsWith("key-hwnd:101:"));
const run = (step: object, dialogs = [fileDialog(602, 202), fileDialog(501, 101)], extra: object = {}) =>
  runDialog([bind, { op: "filedialog", window: "A", _identity: identity, ...step }], { dialogs, dialogForeground: 501, ...extra });

describe("D336 F2 submit and cancel have distinct effects", () => {
  it.each(["Open", "Save As"])("%s cancel sends one Esc to A's dialog and writes no path, even a supplied one", async (title) => {
    const result = await run({ cancel: true, path: "C:\\audit\\wrong.md" }, [fileDialog(602, 202), fileDialog(501, 101, { title })]);
    expect(result.status, result.log.join("\n")).toBe(0);
    expect(dialogEffects(result.trace)).toEqual(["key-hwnd:501:27:0", "key-hwnd:501:27:2", "dialog-cancel:501"]);
    expect(result.log.join("\n")).toMatch(/dialog cancelled[\s\S]*dialog dismissed/);
    expect(result.outcome).toMatchObject({ status: "completed", inputOutcome: "partial", heldInput: "released" });
  });

  it("Save As submit writes the path once, sends one Enter and observes dismissal", async () => {
    const path = "C:\\audit\\out a.md";
    const result = await run({ path }, [fileDialog(602, 202), fileDialog(501, 101, { title: "Save As" })]);
    expect(result.status, result.log.join("\n")).toBe(0);
    expect(dialogEffects(result.trace)).toEqual([`dialog-write:5012:12:${path}`, "key-hwnd:501:13:0", "key-hwnd:501:13:2", "dialog-submit:501"]);
    expect(result.log.join("\n")).toContain("dialog dismissed");
  });

  it.each([[{ path: "C:\\audit\\out a.md" }, 13], [{ cancel: true }, 27]] as const)(
    "a dialog that stays open after %o is reported as not dismissed, with a partial outcome", async (step, key) => {
      const result = await run(step, undefined, { dialogStaysOpen: true });
      expect(result.status).toBe(1);
      expect(result.log.join("\n")).toContain("UI_DIALOG_NOT_DISMISSED");
      expect(result.log.join("\n")).not.toContain("dialog dismissed");
      expect(result.outcome).toMatchObject({ status: "failed", phase: "dialog-dismissal", inputOutcome: "partial" });
      expect(dialogEffects(result.trace).filter((line) => line.startsWith("key-hwnd:"))).toEqual([`key-hwnd:501:${key}:0`, `key-hwnd:501:${key}:2`]);
    });

  it("cancel without A's unique dialog refuses with no key", async () => {
    const result = await run({ cancel: true }, [fileDialog(501, 101), fileDialog(503, 101)]);
    expect(result.status).toBe(1);
    expect(result.log.join("\n")).toContain("IDENTITY_DIALOG_AMBIGUOUS");
    expect(dialogEffects(result.trace)).toEqual([]);
    expect(result.outcome).toMatchObject({ status: "failed", inputOutcome: "none" });
  });
});
