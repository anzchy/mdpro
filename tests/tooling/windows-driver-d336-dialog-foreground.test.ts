// @vitest-environment node
/**
 * D336 F4 (native half): a wrong foreground and every non-receipt authorization failure refuse
 * before any path write or key. Foreground is only the final safety predicate: A's dialog is
 * still resolved by owner chain, and B's dialog, B's window or an unrelated window in front stops
 * the run with both dialogs untouched. A foreground that moves after the write stops before Enter,
 * with a truthful partial outcome. `onError:continue` never lets a later step run after an
 * identity failure. Production ui.ps1 under pwsh with Win32 doubles only.
 */
import { describe, expect, it, vi } from "vitest";
import { effects, fileDialog, identity, runDialog } from "./windows-driver-native-dialog-harness";

vi.setConfig({ testTimeout: 30_000 });

const PATH = "C:\\audit\\a.md";
const bind = { op: "menuinfo", window: "A", _identity: identity };
const both = () => [fileDialog(602, 202), fileDialog(501, 101)];
const dialogEffects = (trace: string[]) => effects(trace).filter((line) => !line.startsWith("key-hwnd:101:"));
const run = (step: object, extra: object = {}, dialogs = both(), trailing: object[] = []) =>
  runDialog([bind, { op: "filedialog", window: "A", _identity: identity, ...step }, ...trailing],
    { dialogs, dialogForeground: 501, ...extra });

describe("D336 F4 wrong foreground and non-receipt authorization failures refuse before input", () => {
  it.each([
    ["B's own dialog", 602],
    ["B's window", 202],
    ["an unrelated window", 999],
  ])("%s in front, with A's and B's dialogs both open, refuses before any write or key", async (_name, foreground) => {
    for (const step of [{ path: PATH }, { cancel: true }]) {
      const result = await run(step, { dialogForeground: foreground });
      expect(result.status).toBe(1);
      expect(result.log.join("\n")).toContain("IDENTITY_DIALOG_FOREGROUND");
      expect(result.log.join("\n")).toContain("dialog owner=101 dialog=501 control=5012");
      expect(dialogEffects(result.trace)).toEqual([]);
      expect(result.trace.some((line) => line.startsWith("focus-request:"))).toBe(false);
      expect(result.outcome).toMatchObject({ status: "failed", inputOutcome: "none", heldInput: "released" });
    }
  });

  it("a foreground that moves to B's dialog after the write stops before Enter, with a partial outcome", async () => {
    const result = await run({ path: PATH }, { dialogForegroundAfterWrite: 602 });
    expect(result.status).toBe(1);
    expect(result.log.join("\n")).toContain("IDENTITY_DIALOG_FOREGROUND");
    expect(dialogEffects(result.trace)).toEqual([`dialog-write:5012:12:${PATH}`]);
    expect(result.outcome).toMatchObject({ status: "failed", inputOutcome: "partial", heldInput: "released" });
  });

  it("onError:continue does not let a trailing step send input after the refusal", async () => {
    const trailing = [{ op: "chord", window: "A", keys: ["ctrl+a"], _identity: identity }];
    const result = await run({ path: PATH, onError: "continue" }, { dialogForeground: 602 }, both(), trailing);
    expect(result.status).toBe(1);
    expect(result.log.join("\n")).toContain("ABORTED at step 2");
    expect(result.trace.filter((line) => line.startsWith("key-hwnd:"))).toEqual([]);
    expect(result.outcome).toMatchObject({ status: "failed", completedSteps: 1, inputOutcome: "none" });
  });

  it.each([
    ["an unknown label", { window: "C" }, both(), "IDENTITY_LABEL_NOT_UNIQUE"],
    ["a non-file modal owned by A", {}, [fileDialog(602, 202), { hwnd: 501, owner: 101, className: "#" + "32770", title: "mdpro",
      controls: [{ hwnd: 5011, className: "Button", id: 2 }, { hwnd: 5012, className: "Static", id: 65535 }] }],
      "IDENTITY_DIALOG_CONTROL_NOT_FOUND"],
    ["A's dialog in another process", {}, [fileDialog(602, 202), fileDialog(501, 101, { pid: 12 })], "IDENTITY_DIALOG_NOT_FOUND"],
  ])("%s refuses with no write or key", async (_name, step, dialogs, error) => {
    const result = await run({ path: PATH, ...step }, {}, dialogs);
    expect(result.status).toBe(1);
    expect(result.log.join("\n")).toContain(error);
    expect(dialogEffects(result.trace)).toEqual([]);
    expect(result.outcome).toMatchObject({ status: "failed", inputOutcome: "none" });
  });
});
