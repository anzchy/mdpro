// @vitest-environment node
/**
 * D336 F7, a lost issue response (ruling 4, Continuation 14 addendum): the issuing run stores its
 * receipt and then fails, so the Mac never trusts its token and never replays it. That orphan is
 * inert: the next issue for the same owner invalidates it, so its token is refused with no write
 * or key even while A still carries the orphan's pin, and only the new receipt is stored and
 * usable. Production ui.ps1 under pwsh with Win32 doubles only; the store is a real directory.
 */
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { effects, fileDialog, identity, runDialog } from "./windows-driver-native-dialog-harness";

vi.setConfig({ testTimeout: 60_000 });

const PATH = "C:\\audit\\a.md";
const both = () => [fileDialog(602, 202), fileDialog(501, 101)];
const stored = async (dir: string) => (await readdir(dir).catch(() => [] as string[])).filter((name) => name.endsWith(".json"));
const tokenOf = (log: string[]) => /^receipt ([a-f0-9]{64})$/m.exec(log.join("\n"))?.[1];
const dialogEffects = (trace: string[]) => effects(trace).filter((line) => !line.startsWith("key-hwnd:101:"));
const pinOf = async (dir: string) => {
  const r = JSON.parse(await readFile(path.join(dir, (await stored(dir))[0]), "utf8"));
  return { [r.pinKey]: r.pinValue } as Record<string, string>;
};
const issue = (dir: string, after: object[]) => runDialog([{ op: "dialogReceipt", window: "A", _identity: identity }, ...after],
  { dialogs: both(), dialogOpensOn: "chord", dialogForeground: 501 }, { receiptDir: dir });
const consume = (dir: string, receipt: string, props: Record<string, string>) => runDialog([{ op: "filedialog", receipt, path: PATH }],
  { dialogs: both(), dialogForeground: 501, ownerProps: props }, { receiptDir: dir, noCdp: true });

describe("D336 F7 an orphaned receipt from a lost issue response", () => {
  it("is invalidated by the next issue for its owner, and its token is then refused even with its pin on A", async () => {
    const dir = path.join(await mkdtemp(path.join(os.tmpdir(), "mdpro-receipts-")), "store");
    const lost = await issue(dir, [{ op: "chord", window: "C", keys: ["ctrl+o"], _identity: identity }]);
    expect(lost.status).toBe(1);
    const orphan = tokenOf(lost.log);
    expect(orphan).toMatch(/^[a-f0-9]{64}$/);
    expect(await stored(dir)).toHaveLength(1);
    const orphanName = (await stored(dir))[0];
    const orphanPin = await pinOf(dir);

    const next = await issue(dir, [{ op: "chord", window: "A", keys: ["ctrl+o"], _identity: identity }]);
    expect(next.status, next.log.join("\n") + next.stderr).toBe(0);
    const current = tokenOf(next.log) as string;
    expect(current).toMatch(/^[a-f0-9]{64}$/);
    expect(current).not.toBe(orphan);
    const left = await stored(dir);
    expect(left).toHaveLength(1);
    expect(left).not.toContain(orphanName);
    const currentPin = await pinOf(dir);

    const refused = await consume(dir, orphan as string, { ...orphanPin, ...currentPin });
    expect(refused.status).toBe(1);
    expect(refused.log.join("\n")).toContain("IDENTITY_RECEIPT_INVALID");
    expect(dialogEffects(refused.trace)).toEqual([]);
    expect(await stored(dir)).toHaveLength(1);

    const used = await consume(dir, current, currentPin);
    expect(used.status, used.log.join("\n")).toBe(0);
    expect(dialogEffects(used.trace)).toEqual([`dialog-write:5012:12:${PATH}`, "key-hwnd:501:13:0", "key-hwnd:501:13:2", "dialog-submit:501"]);
    expect(await stored(dir)).toEqual([]);
  });
});
