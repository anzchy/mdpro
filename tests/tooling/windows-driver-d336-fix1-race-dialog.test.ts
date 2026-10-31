// @vitest-environment node
/**
 * D336 fix 1 (MH1, dialog half): the check-to-input race. The progress write that marks a dialog
 * mutation as possibly sent is durable before the final foreground and pin checks, and nothing
 * else happens between those checks and the mutation. A foreground switch or a same-HWND dialog
 * successor injected exactly at that progress write (the old gap) therefore stops the path write,
 * the Esc and the Enter before they are sent. Production ui.ps1 under pwsh with Win32 doubles.
 */
import { describe, expect, it, vi } from "vitest";
import { effects, fileDialog, identity, runDialog } from "./windows-driver-native-dialog-harness";
import type { ProgressScenario } from "./windows-driver-native-progress-fake";

vi.setConfig({ testTimeout: 30_000 });

const PATH = "C:\\audit\\a.md";
const bind = { op: "menuinfo", window: "A", _identity: identity };
const dialogEffects = (trace: string[]) => effects(trace).filter((line) => !line.startsWith("key-hwnd:101:"));
const run = (step: object, progressTransition: ProgressScenario["progressTransition"]) =>
  runDialog([bind, { op: "filedialog", window: "A", _identity: identity, ...step }],
    { dialogs: [fileDialog(602, 202), fileDialog(501, 101)], dialogForeground: 501, progressTransition });

describe("D336 fix 1 a transition at the progress write never reaches a dialog mutation", () => {
  it("a foreground switch at the path phase's progress write sends no path", async () => {
    const result = await run({ path: PATH }, { phase: "input:dialog-path", foreground: 602 });
    expect(dialogEffects(result.trace)).toEqual([]);
  });

  it("a foreground switch at the cancel phase's progress write sends no Esc", async () => {
    const result = await run({ cancel: true }, { phase: "input:dialog-cancel", foreground: 602 });
    expect(dialogEffects(result.trace)).toEqual([]);
  });

  it("a same-HWND dialog successor at the submit phase's progress write gets no Enter", async () => {
    const result = await run({ path: PATH }, { phase: "input:dialog-submit", replaceDialog: 501 });
    expect(dialogEffects(result.trace)).toEqual([`dialog-write:5012:12:${PATH}`]);
  });
});
