// @vitest-environment node
/**
 * D336 F7 sole route: an unlabelled `filedialog` with one mdpro window binds that window as the
 * dialog's owner even when UIA lists the open dialog as a top-level window of the same process.
 * An owned window (the dialog, any popup) is never a candidate owner, so the dialog cannot make
 * the sole route ambiguous or bind itself. Two unowned mdpro windows still refuse unlabelled,
 * with no path write and no key. Production ui.ps1 under pwsh with Win32 doubles only.
 */
import { describe, expect, it, vi } from "vitest";
import { effects, fileDialog, runDialog } from "./windows-driver-native-dialog-harness";

vi.setConfig({ testTimeout: 30_000 });

const PATH = "C:\\audit\\测试 a.md";
const sole = { secondMdpro: false, dialogs: [fileDialog(501, 101)], dialogForeground: 501, dialogInUiaRoot: true };

describe("D336 F7 the unlabelled sole route never counts the dialog as an owner", () => {
  it("submits A's dialog when UIA also lists the dialog as a top-level mdpro window", async () => {
    const result = await runDialog([{ op: "filedialog", path: PATH }], sole);
    expect(result.status, result.log.join("\n") + result.stderr).toBe(0);
    expect(result.log.join("\n")).toContain("bound label= hwnd=101");
    expect(effects(result.trace)).toEqual([`dialog-write:5012:12:${PATH}`, "key-hwnd:501:13:0", "key-hwnd:501:13:2", "dialog-submit:501"]);
    expect(result.outcome).toMatchObject({ status: "completed", completedSteps: 1, cleanup: "complete" });
  });

  it("cancels A's dialog on the same route, with no path write", async () => {
    const result = await runDialog([{ op: "filedialog", cancel: true, path: PATH }], sole);
    expect(result.status, result.log.join("\n") + result.stderr).toBe(0);
    expect(effects(result.trace)).toEqual(["key-hwnd:501:27:0", "key-hwnd:501:27:2", "dialog-cancel:501"]);
  });

  it("refuses unlabelled with two unowned mdpro windows, each with a dialog, before any write or key", async () => {
    const result = await runDialog([{ op: "filedialog", path: PATH }],
      { ...sole, secondMdpro: true, dialogs: [fileDialog(602, 202), fileDialog(501, 101)] });
    expect(result.status).toBe(1);
    expect(result.log.join("\n")).toContain("IDENTITY");
    expect(effects(result.trace)).toEqual([]);
    expect(result.outcome).toMatchObject({ status: "failed", inputOutcome: "none" });
  });
});
