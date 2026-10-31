// @vitest-environment node
/**
 * D336 F7, owner loss before consume: a receipt names one window of one process. When the stored
 * owner has moved, its pid now differs, the same HWND belongs to a process with another start
 * time, or the process is another executable, the consumer refuses with the lifetime code that
 * names the change, writes no path and sends no key, and the receipt is used up either way.
 * Production ui.ps1 under pwsh with Win32 doubles only; the store is a real directory.
 */
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { NativeScenario } from "./windows-driver-native-harness";
import { effects, fileDialog, identity, runDialog } from "./windows-driver-native-dialog-harness";

vi.setConfig({ testTimeout: 60_000 });

const PATH = "C:\\audit\\a.md";
const both = () => [fileDialog(602, 202), fileDialog(501, 101)];
const stored = async (dir: string) => (await readdir(dir).catch(() => [] as string[])).filter((name) => name.endsWith(".json"));
const tokenOf = (log: string[]) => /^receipt ([a-f0-9]{64})$/m.exec(log.join("\n"))?.[1];
const dialogEffects = (trace: string[]) => effects(trace).filter((line) => !line.startsWith("key-hwnd:101:"));

async function issued() {
  const dir = path.join(await mkdtemp(path.join(os.tmpdir(), "mdpro-receipts-")), "store");
  const producer = await runDialog([
    { op: "dialogReceipt", window: "A", _identity: identity },
    { op: "chord", window: "A", keys: ["ctrl+o"], _identity: identity },
  ], { dialogs: both(), dialogOpensOn: "chord", dialogForeground: 501 }, { receiptDir: dir });
  expect(producer.status, producer.log.join("\n") + producer.stderr).toBe(0);
  const token = tokenOf(producer.log);
  expect(token).toMatch(/^[a-f0-9]{64}$/);
  const r = JSON.parse(await readFile(path.join(dir, (await stored(dir))[0]), "utf8"));
  return { dir, token: token as string, props: { [r.pinKey]: r.pinValue } as Record<string, string> };
}

const changes: Array<[string, NativeScenario, string | undefined, string]> = [
  ["the owner moved", { rectChangeAt: 1 }, undefined, "IDENTITY_NATIVE_RECT_CHANGED"],
  ["the HWND now reports another pid", { threadChangeAt: 1 }, undefined, "IDENTITY_NATIVE_STALE"],
  ["the same HWND and pid belong to a process with another start time", {}, "2026-01-02T00:00:00Z", "IDENTITY_PROCESS_LIFETIME"],
  ["the owner's process is another executable", { wrongExeAt: 1 }, undefined, "IDENTITY_PROCESS_PATH"],
];

describe("D336 F7 a receipt whose owner changed before consume authorizes nothing", () => {
  it.each(changes)("%s: refuses with no write or key, and the receipt is used up", async (_name, scene, processStart, code) => {
    const { dir, token, props } = await issued();
    const result = await runDialog([{ op: "filedialog", receipt: token, path: PATH }],
      { dialogs: both(), dialogForeground: 501, ownerProps: props, ...scene }, { receiptDir: dir, noCdp: true, processStart });
    expect(result.status, result.log.join("\n")).toBe(1);
    expect(result.log.join("\n")).toContain(code);
    expect(dialogEffects(result.trace)).toEqual([]);
    expect(result.outcome).toMatchObject({ status: "failed", inputOutcome: "none" });
    expect(await stored(dir)).toEqual([]);
  });
});
