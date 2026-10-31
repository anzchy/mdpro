// @vitest-environment node
/**
 * D336 fix 1 (gpt M1): WM_SETTEXT's result is checked. An Edit that returns FALSE, or whose
 * WM_GETTEXT read-back differs from the intended path, stops the run before Enter with a named
 * error, so a dialog never submits the filename it held before. Production ui.ps1 under pwsh.
 */
import { describe, expect, it, vi } from "vitest";
import { effects, fileDialog, identity, runDialog } from "./windows-driver-native-dialog-harness";

vi.setConfig({ testTimeout: 30_000 });

const PATH = "C:\\audit\\a.md";
const bind = { op: "menuinfo", window: "A", _identity: identity };
const dialogEffects = (trace: string[]) => effects(trace).filter((line) => !line.startsWith("key-hwnd:101:"));
const run = (extra: object) =>
  runDialog([bind, { op: "filedialog", window: "A", _identity: identity, path: PATH }],
    { dialogs: [fileDialog(602, 202), fileDialog(501, 101)], dialogForeground: 501, ...extra });

describe("D336 fix 1 a failed path write is never submitted", () => {
  it("WM_SETTEXT returning FALSE stops before Enter", async () => {
    const result = await run({ dialogWriteRejected: true });
    expect(dialogEffects(result.trace)).toEqual([`dialog-write:5012:12:${PATH}`]);
  });

  it("a read-back that differs from the path stops before Enter", async () => {
    const result = await run({ dialogWriteText: "C:\\audit\\old.md" });
    expect(dialogEffects(result.trace)).toEqual([`dialog-write:5012:12:${PATH}`]);
  });
});
