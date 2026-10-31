// Purpose: pure owner-chain decision for a native common file dialog (D336), shared by Mac tests
// and native-dialog.ps1. A dialog belongs to the verified owner only by its owner chain, the
// owner's process lifetime (pid + birth) and executable, the common-dialog class and exactly one
// filename Edit. Title, foreground, list order and window count are never read.
// Input: { owner: { hwnd, pid, birth }, expectedExe, windows: [{ hwnd, pid, birth, exe, className,
//   visible, ownerChain: [hwnd...], chainComplete, controls: [{ hwnd, className, ctrlId,
//   parentCtrlId, visible }] }] }. Output: { dialogHwnd, controlHwnd, pid, birth, depth }.
import { fileURLToPath } from "node:url";

const DIALOG_CLASS = "#" + "32770";
const MAX_CHAIN = 32;
// Common-dialog filename identifiers: the Edit (1001) inside the filename combo cmb13 (1148),
// or the legacy edt1 (1152). Names are localized and never decide.
const isFileEdit = (c) => c && c.visible === true && typeof c.className === "string" &&
  c.className.toLowerCase() === "edit" && (c.ctrlId === 1001 && c.parentCtrlId === 1148 || c.ctrlId === 1152);
const fail = (reason) => { throw new Error(`DIALOG_${reason}`); };
const isHwnd = (v) => typeof v === "string" && /^[1-9][0-9]*$/.test(v);
const normalizedExe = (value) => typeof value === "string" ? value.replaceAll("/", "\\").toLowerCase() : "";

export function resolveDialog(input) {
  const { owner, expectedExe, windows } = input ?? {};
  if (!Array.isArray(windows) || typeof expectedExe !== "string" || !expectedExe) fail("INPUT_INVALID");
  if (!owner || !isHwnd(owner.hwnd) || !Number.isSafeInteger(owner.pid) || owner.pid <= 0 ||
      typeof owner.birth !== "string" || !owner.birth) fail("OWNER_INVALID");
  const seen = new Set();
  for (const w of windows) {
    if (!w || !isHwnd(w.hwnd)) fail("WINDOW_INVALID");
    for (const h of [w.hwnd, ...(Array.isArray(w.controls) ? w.controls.map((c) => c?.hwnd) : [])]) {
      if (seen.has(h)) fail("HWND_DUPLICATE");
      seen.add(h);
    }
  }
  // A window of the owner's pid with no birth cannot be placed in or out of its lifetime.
  const ownPid = windows.filter((w) => w.pid === owner.pid);
  for (const w of ownPid) if (typeof w.birth !== "string" || !w.birth) fail("WINDOW_INVALID");
  const ownProcess = ownPid.filter((w) => w.birth === owner.birth && normalizedExe(w.exe) === normalizedExe(expectedExe));
  const eligible = [];
  for (const w of ownProcess) {
    const chain = w.ownerChain;
    if (!Array.isArray(chain) || w.chainComplete !== true || chain.length > MAX_CHAIN ||
        !chain.every(isHwnd) || new Set(chain).size !== chain.length || chain.includes(w.hwnd)) fail("OWNER_CHAIN_INVALID");
    if (w.visible === true && w.className === DIALOG_CLASS && chain.includes(owner.hwnd)) eligible.push(w);
  }
  if (eligible.length === 0) fail("NOT_FOUND");
  if (eligible.length > 1) fail("AMBIGUOUS");
  const dialog = eligible[0];
  const controls = (Array.isArray(dialog.controls) ? dialog.controls : []).filter(isFileEdit);
  if (controls.length === 0) fail("CONTROL_NOT_FOUND");
  if (controls.length > 1) fail("CONTROL_AMBIGUOUS");
  return { dialogHwnd: dialog.hwnd, controlHwnd: controls[0].hwnd, pid: owner.pid, birth: owner.birth,
    depth: dialog.ownerChain.indexOf(owner.hwnd) + 1 };
}


if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const request = JSON.parse(Buffer.from(process.argv[2] ?? "", "base64").toString("utf8"));
    process.stdout.write(JSON.stringify(resolveDialog(request)));
  } catch (error) {
    // Reported on stdout, as physical-chord.mjs does, so the bounded caller can name the refusal.
    process.stdout.write(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    process.exitCode = 1;
  }
}
