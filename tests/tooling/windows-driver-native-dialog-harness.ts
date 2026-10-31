import { writeFileSync } from "node:fs";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { startFakeCdp, type FakePage } from "../support/fakeCdp";
import type { DialogScenario, FakeDialog } from "./windows-driver-native-dialog-fake";
import { runNative, type NativeOptions, type NativeScenario } from "./windows-driver-native-harness";

// Labelled A/B in one process (pid 11, thread 7): A is hwnd 101 at [0,0,800,600], B is 202.
// The A binding is made in-run through the real cdp.mjs title challenge against a fake CDP page.
export const identity = [
  { label: "A", pageId: "p1", rect: [0, 0, 800, 600] },
  { label: "B", pageId: "p2", rect: [900, 0, 1700, 600] },
];
const DIALOG_CLASS = "#" + "32770";

/** A common file dialog with the Vista filename combo (1148) holding its Edit (1001). */
export function fileDialog(hwnd: number, owner: number, extra: Partial<FakeDialog> = {}): FakeDialog {
  return { hwnd, owner, className: DIALOG_CLASS, title: "Open", controls: [
    { hwnd: hwnd * 10 + 1, className: "ComboBox", id: 1148 },
    { hwnd: hwnd * 10 + 2, className: "Edit", id: 1001, parent: hwnd * 10 + 1 },
    { hwnd: hwnd * 10 + 3, className: "Edit", id: 1152, parent: hwnd * 10 + 9, visible: false },
  ], ...extra };
}

/**
 * `noCdp` runs with no CDP endpoint at all, as a separate receipt consumer must; `unbindFails`
 * makes the page refuse the title restore; `processStart` gives mdpro a different start time;
 * `phaseMs` and `deadlineMs` override the phase and transaction budgets. `pageB` adds B's page
 * (p2), so label B binds in-run through the same title challenge, on its own title file.
 */
export async function runDialog(steps: unknown[], scenario: NativeScenario & DialogScenario,
  options: Pick<NativeOptions, "receiptDir" | "receiptNow" | "processStart" | "phaseMs" | "deadlineMs"> & { noCdp?: boolean; unbindFails?: boolean; pageB?: boolean } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mdpro-dialog-"));
  const titlePath = path.join(dir, "title.txt");
  const titleB = path.join(dir, "title-b.txt");
  await Promise.all([fs.writeFile(titlePath, "mdpro"), fs.writeFile(titleB, "mdpro B")]);
  const page = (id: string, label: string, base: string, file: string): FakePage => ({ id, evaluate: (expression) => {
    const record = identity.find((entry) => entry.label === label);
    if (expression.includes("IDENTITY_STALE_BEFORE_BIND")) {
      const nonce = /mdpro-b7:([a-f0-9]{32})/.exec(expression)?.[1];
      if (!nonce) return { result: { type: "object" }, exceptionDetails: { text: "no nonce" } };
      const challenge = `${base} [mdpro-b7:${nonce}]`;
      writeFileSync(file, challenge);
      return { result: { type: "object", value: { label, rect: record?.rect, challenge } } };
    }
    if (expression.includes("IDENTITY_UNBIND_MARKER_MISSING")) {
      if (options.unbindFails) return { result: { type: "object" }, exceptionDetails: { text: "unbind refused" } };
      writeFileSync(file, base);
      return { result: { type: "object", value: { label, restored: true } } };
    }
    return { result: { type: "string", value: label } };
  } });
  const server = await startFakeCdp([page("p1", "A", "mdpro", titlePath), ...(options.pageB ? [page("p2", "B", "mdpro B", titleB)] : [])]);
  try {
    const result = await runNative(steps, { secondMdpro: true, ...scenario, ...(options.pageB ? { titleB } : {}) } as NativeScenario,
      { cdpPort: options.noCdp ? 1 : server.port, titlePath, receiptDir: options.receiptDir, receiptNow: options.receiptNow, processStart: options.processStart, phaseMs: options.phaseMs, deadlineMs: options.deadlineMs });
    const outcome = JSON.parse(result.log.filter((line) => line.startsWith("OUTCOME ")).at(-1)?.slice(8) ?? "null");
    return { ...result, outcome, title: await fs.readFile(titlePath, "utf8") };
  } finally { await server.close(); }
}

/** Every native mutation the fake saw: path writes and key events, with their recipient HWND. */
export const effects = (trace: string[]) =>
  trace.filter((line) => /^(dialog-write|dialog-submit|dialog-cancel|key-hwnd):/.test(line));
