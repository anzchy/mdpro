// @vitest-environment node
/**
 * D336 F6: the production pure dialog resolver. A dialog belongs to the verified owner only by
 * owner chain, process lifetime, executable, the common-dialog class and one filename control.
 * Title, foreground and list order never decide it; unrelated additions never change it; broken
 * observations of the owner's process refuse. No mocks: these call the real resolver.
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const RESOLVER = path.resolve(__dirname, "../../.agents/skills/remote-windows-device-test/scripts/windows/dialog-binding.mjs");
const { resolveDialog } = await import(pathToFileURL(RESOLVER).href);

const EXE = "D:\\programs\\mdpro\\tauri-app.exe";
// Win32 atom class names (the common dialog and the menu popup), built so they are not read as colours.
const DIALOG_CLASS = `#${32770}`;
const MENU_CLASS = `#${32768}`;
const owner = { hwnd: "101", pid: 11, birth: "638700000000000000" };
type Control = { hwnd: string; className: string; ctrlId: number; parentCtrlId: number; visible: boolean };
type Win = {
  hwnd: string; pid: number; birth?: string; exe: string; className: string; visible: boolean; title: string;
  ownerChain: unknown[]; chainComplete: boolean; controls: Control[];
};
const edit = (hwnd: string, extra: Partial<Control> = {}): Control =>
  ({ hwnd, className: "Edit", ctrlId: 1001, parentCtrlId: 1148, visible: true, ...extra });
const win = (hwnd: string, chain: unknown[], extra: Partial<Win> = {}): Win => ({
  hwnd, pid: 11, birth: owner.birth, exe: EXE, className: DIALOG_CLASS, visible: true, title: "Open",
  ownerChain: chain, chainComplete: true, controls: [edit(hwnd + "1")], ...extra,
});

const aDialog = win("501", ["101"], { title: "打开" });
const base = [
  win("101", [], { className: "Tauri Window", title: "mdpro", controls: [] }),
  win("202", [], { className: "Tauri Window", title: "mdpro B", controls: [] }),
  aDialog,
];
// Each of these is unrelated to A's file dialog; adding any subset must not change the answer.
const unrelated = [
  win("602", ["202"], { title: "Open" }), // B's own Open dialog, same process and thread
  win("603", ["602", "202"], { title: "Open" }), // nested under B
  win("900", ["101"], { pid: 99, birth: "1", exe: "C:\\other\\app.exe" }), // other process, owned by A
  win("901", ["101"], { pid: 11, birth: "638700000000000001" }), // pid reused by a later process
  win("902", ["101"], { exe: "C:\\other\\tauri-app.exe" }), // same pid, other executable
  win("503", ["101"], { className: MENU_CLASS, controls: [] }), // A's menu popup
  win("504", ["101"], { visible: false }), // hidden A dialog
  win("905", ["905"], { pid: 77, birth: "3", exe: "C:\\x.exe" }), // a cycle in another process
];
const expected = { dialogHwnd: "501", controlHwnd: "5011", pid: 11, birth: owner.birth, depth: 1 };

function attempt(input: unknown) {
  try { return { ok: true as const, value: resolveDialog(input) }; }
  catch (error) { return { ok: false as const, error: error instanceof Error ? error.message : String(error) }; }
}
const resolve = (windows: Win[], extra: object = {}) => attempt({ owner, expectedExe: EXE, windows, ...extra });

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  return items.flatMap((item, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]));
}

describe("D336 F6 dialog ownership is decided by owner chain, lifetime, class and one filename control", () => {
  it("resolves A's unique Open dialog and its filename control", () => {
    expect(resolve(base)).toEqual({ ok: true, value: expected });
  });

  it("is invariant under every permutation of the candidates, whatever the titles and foreground say", () => {
    const set = [...base, unrelated[0], unrelated[2], unrelated[5]];
    for (const order of permutations(set)) {
      for (const foreground of ["602", "202", "900", "101"]) {
        expect(resolve(order, { foreground })).toEqual({ ok: true, value: expected });
      }
    }
  });

  it("is invariant under every subset of unrelated additions", () => {
    for (let mask = 0; mask < 1 << unrelated.length; mask++) {
      const extra = unrelated.filter((_, i) => mask & (1 << i));
      expect(resolve([...extra, ...base]), `mask ${mask}`).toEqual({ ok: true, value: expected });
    }
  });

  it("accepts owner-chain depths 1 to 32 and refuses an incomplete or longer chain", () => {
    for (let depth = 1; depth <= 32; depth++) {
      const chain = [...Array.from({ length: depth - 1 }, (_, i) => String(7000 + i)), "101"];
      const deep = win("501", chain);
      expect(resolve([base[0], deep]), `depth ${depth}`).toEqual({ ok: true, value: { ...expected, depth } });
    }
    const long = [...Array.from({ length: 32 }, (_, i) => String(7000 + i)), "101"];
    expect(resolve([base[0], win("501", long)])).toEqual({ ok: false, error: "DIALOG_OWNER_CHAIN_INVALID" });
    expect(resolve([base[0], win("501", ["101"], { chainComplete: false })])).toEqual({ ok: false, error: "DIALOG_OWNER_CHAIN_INVALID" });
  });

  it.each([
    ["a cycle through the candidate itself", ["505", "101"]],
    ["a duplicated link", ["7000", "7000", "101"]],
    ["a non-numeric link", ["x", "101"]],
    ["a missing link", [null, "101"]],
    ["a numeric, not string, link", [101]],
  ])("refuses %s in a chain of the owner's process", (_name, chain) => {
    expect(resolve([...base, win("505", chain)])).toEqual({ ok: false, error: "DIALOG_OWNER_CHAIN_INVALID" });
  });

  it("refuses zero and two eligible dialogs, never picking the first", () => {
    expect(resolve(base.filter((w) => w !== aDialog))).toEqual({ ok: false, error: "DIALOG_NOT_FOUND" });
    for (const second of [win("506", ["101"]), win("507", ["501", "101"], { title: "Confirm" })]) {
      expect(resolve([...base, second])).toEqual({ ok: false, error: "DIALOG_AMBIGUOUS" });
      expect(resolve([second, ...base])).toEqual({ ok: false, error: "DIALOG_AMBIGUOUS" });
    }
  });

  it("counts only a visible Edit with the common-dialog filename identifiers, whatever its name", () => {
    const withControls = (controls: Control[]) => resolve([base[0], win("501", ["101"], { controls })]);
    expect(withControls([])).toEqual({ ok: false, error: "DIALOG_CONTROL_NOT_FOUND" });
    expect(withControls([edit("5011"), edit("5012", { ctrlId: 1152, parentCtrlId: 0 })]))
      .toEqual({ ok: false, error: "DIALOG_CONTROL_AMBIGUOUS" });
    const decoys = [
      edit("5013", { ctrlId: 1000 }), // an unrelated Edit
      edit("5014", { parentCtrlId: 1200 }), // id 1001 outside the filename combo
      edit("5015", { className: "Static" }),
      edit("5016", { visible: false }),
    ];
    expect(withControls(decoys)).toEqual({ ok: false, error: "DIALOG_CONTROL_NOT_FOUND" });
    expect(withControls([...decoys, edit("5011")])).toEqual({ ok: true, value: expected });
    expect(withControls([edit("5012", { ctrlId: 1152, parentCtrlId: 0, className: "EDIT" })]))
      .toEqual({ ok: true, value: { ...expected, controlHwnd: "5012" } });
  });

  it("refuses invalid owner, lifetime and list observations", () => {
    expect(attempt({ owner: { ...owner, birth: "" }, expectedExe: EXE, windows: base })).toEqual({ ok: false, error: "DIALOG_OWNER_INVALID" });
    expect(attempt({ owner: { ...owner, hwnd: "0x65" }, expectedExe: EXE, windows: base })).toEqual({ ok: false, error: "DIALOG_OWNER_INVALID" });
    expect(attempt({ owner, expectedExe: EXE, windows: "501" })).toEqual({ ok: false, error: "DIALOG_INPUT_INVALID" });
    expect(attempt({ owner, expectedExe: "", windows: base })).toEqual({ ok: false, error: "DIALOG_INPUT_INVALID" });
    expect(resolve([...base, win("508", ["101"], { birth: undefined })])).toEqual({ ok: false, error: "DIALOG_WINDOW_INVALID" });
    expect(resolve([...base, win("501", ["202"])])).toEqual({ ok: false, error: "DIALOG_HWND_DUPLICATE" });
    expect(resolve([...base, win("509", ["101"], { controls: [edit("5011")] })])).toEqual({ ok: false, error: "DIALOG_HWND_DUPLICATE" });
  });
});
