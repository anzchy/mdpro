// @vitest-environment node
/**
 * D336 F1: a labelled `filedialog` acts on A's own common dialog only. A and B are windows of one
 * process; B has its own Open dialog, listed first and titled "Open", while A's is titled "Save".
 * The production ui.ps1 runs under pwsh with Win32 doubles only (native harness + dialog fake);
 * the real window and dialog resolvers decide.
 */
import { describe, expect, it, vi } from "vitest";
import { effects, fileDialog, identity, runDialog } from "./windows-driver-native-dialog-harness";

vi.setConfig({ testTimeout: 30_000 });

const PATH = "C:\\audit\\测试 a.md";
const dialogs = [fileDialog(602, 202, { title: "Open" }), fileDialog(501, 101, { title: "Save" })];
const dialogEffects = (trace: string[]) => effects(trace).filter((line) => !line.startsWith("key-hwnd:101:"));
const submitted = [`dialog-write:5012:12:${PATH}`, "key-hwnd:501:13:0", "key-hwnd:501:13:2", "dialog-submit:501"];

const routes = [
  ["Ctrl+O", "chord", { op: "chord", window: "A", keys: ["ctrl+o"], _identity: identity }],
  ["menuclick File", "menu", { op: "menuclick", window: "A", path: ["File", "Save"], _identity: identity }],
  ["menuat", "menu", { op: "menuat", window: "A", bar: [100, 100], item: [150, 150], _identity: identity }],
  ["a dialog already open after the binding", "start", { op: "menuinfo", window: "A", _identity: identity }],
] as const;

describe("D336 F1 a labelled filedialog writes and submits A's own dialog only", () => {
  it.each(routes)("via %s", async (_name, opensOn, entry) => {
    const result = await runDialog(
      [entry, { op: "filedialog", window: "A", path: PATH, _identity: identity }],
      { dialogs, dialogOpensOn: opensOn, dialogForeground: 501 },
    );
    expect(result.status, result.log.join("\n") + result.stderr).toBe(0);
    expect(result.outcome).toMatchObject({ status: "completed", completedSteps: 2, cleanup: "complete" });
    expect(dialogEffects(result.trace)).toEqual(submitted);
    expect(result.log.join("\n")).toContain("dialog owner=101 dialog=501 control=5012");
    expect(result.title).toBe("mdpro");
  });
});
