// Pure label-to-HWND decision shared by Mac tests and the Windows desktop driver.
// A rect is [left, top, right, bottom] in physical pixels. No pixel tolerance is used until
// the 270% and secondary-monitor device measurements establish one safely.
import { fileURLToPath } from "node:url";

const bad = (reason) => { throw new Error(`IDENTITY_${reason}`); };
const rectOk = (rect) => Array.isArray(rect) && rect.length === 4 &&
  rect.every((n) => Number.isSafeInteger(n)) && rect[2] > rect[0] && rect[3] > rect[1];
const sameRect = (a, b) => a.every((n, i) => n === b[i]);

const normalizedExe = (value) => typeof value === "string" ? value.replaceAll("/", "\\").toLowerCase() : "";

export function resolveWindow({ label, records = [], windows, expected, expectedExe, requireForeground = false, foreground, challenge }) {
  if (!Array.isArray(windows)) bad("WINDOW_LIST");
  if (!Array.isArray(records)) bad("RECORD_LIST");
  const seenLabels = new Set();
  for (const record of records) {
    if (!record || typeof record.label !== "string" || !record.label || !rectOk(record.rect)) bad("RECORD_INVALID");
    if (seenLabels.has(record.label)) bad("LABEL_DUPLICATE");
    seenLabels.add(record.label);
  }
  for (let i = 0; i < records.length; i++) {
    for (let j = i + 1; j < records.length; j++) {
      if (sameRect(records[i].rect, records[j].rect)) bad("RECT_AMBIGUOUS");
    }
  }
  const live = windows.filter((w) => w && w.visible === true);
  const hwnds = new Set();
  for (const w of live) {
    if (!/^\d+$/.test(String(w.hwnd)) || !Number.isSafeInteger(w.pid) || w.pid <= 0 || !rectOk(w.rect)) bad("WINDOW_INVALID");
    if (hwnds.has(String(w.hwnd))) bad("HWND_DUPLICATE");
    hwnds.add(String(w.hwnd));
  }
  let target;
  if (label !== undefined && label !== null) {
    if (typeof label !== "string" || !label) bad("LABEL_INVALID");
    const record = records.find((r) => r.label === label);
    if (!record) bad("LABEL_NOT_FOUND");
    const hits = live.filter((w) => sameRect(w.rect, record.rect));
    if (hits.length !== 1) bad("HWND_AMBIGUOUS");
    target = hits[0];
  } else {
    if (live.length !== 1) bad("WINDOW_COUNT");
    target = live[0];
  }
  if (expectedExe && normalizedExe(target.exe) !== normalizedExe(expectedExe)) bad("PROCESS_PATH");
  if (challenge !== undefined) {
    if (typeof challenge !== "string" || !challenge || target.title !== challenge ||
        live.filter((w) => w.title === challenge).length !== 1) bad("CHALLENGE");
  }
  const result = { label: label ?? null, hwnd: String(target.hwnd), pid: target.pid, rect: target.rect };
  if (expected && (expected.hwnd !== result.hwnd || expected.pid !== result.pid ||
      expected.label !== result.label || !rectOk(expected.rect) || !sameRect(expected.rect, result.rect))) bad("STALE");
  if (requireForeground && String(foreground) !== result.hwnd) bad("FOREGROUND");
  return result;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const input = JSON.parse(Buffer.from(process.argv[2] ?? "", "base64").toString("utf8"));
    process.stdout.write(JSON.stringify(resolveWindow(input)));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
