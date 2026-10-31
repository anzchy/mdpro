// @vitest-environment node
/**
 * D336 F7 sole receipt route: an unlabelled `dialogReceipt` with exactly one mdpro window issues
 * a receipt for that window from native observations only (the sole route has no title
 * challenge, so nothing is bound or restored through CDP), with an empty owner label. A separate
 * no-CDP `filedialog` with the token and no label consumes it; the same token with a label it was
 * not issued for refuses. Two unowned mdpro windows refuse unlabelled at issue, store nothing and
 * send no key. Production ui.ps1 under pwsh with Win32 doubles only; the store is a real directory.
 */
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { effects, fileDialog, runDialog } from "./windows-driver-native-dialog-harness";

vi.setConfig({ testTimeout: 60_000 });

const PATH = "C:\\audit\\测试 a.md";
const submitted = [`dialog-write:5012:12:${PATH}`, "key-hwnd:501:13:0", "key-hwnd:501:13:2", "dialog-submit:501"];
const soleScene = { secondMdpro: false, dialogs: [fileDialog(501, 101)], dialogForeground: 501, dialogInUiaRoot: true };
const newStore = async () => path.join(await mkdtemp(path.join(os.tmpdir(), "mdpro-receipts-")), "store");
const stored = async (dir: string) => (await readdir(dir).catch(() => [] as string[])).filter((name) => name.endsWith(".json"));
const tokenOf = (log: string[]) => /^receipt ([a-f0-9]{64})$/m.exec(log.join("\n"))?.[1];
const dialogEffects = (trace: string[]) => effects(trace).filter((line) => !line.startsWith("key-hwnd:101:"));

const issue = (dir: string, scene: object = soleScene) =>
  runDialog([{ op: "dialogReceipt" }, { op: "chord", keys: ["ctrl+o"] }], { ...scene, dialogOpensOn: "chord" }, { receiptDir: dir });
const consume = (dir: string, step: object, props: Record<string, string>) =>
  runDialog([{ op: "filedialog", path: PATH, ...step }], { ...soleScene, ownerProps: props }, { receiptDir: dir, noCdp: true });

async function issued(dir: string) {
  const producer = await issue(dir);
  expect(producer.status, producer.log.join("\n") + producer.stderr).toBe(0);
  const token = tokenOf(producer.log);
  expect(token).toMatch(/^[a-f0-9]{64}$/);
  expect(await stored(dir)).toHaveLength(1);
  const r = JSON.parse(await readFile(path.join(dir, (await stored(dir))[0]), "utf8"));
  return { producer, token: token as string, r, props: { [r.pinKey]: r.pinValue } as Record<string, string> };
}

describe("D336 F7 a receipt issued from the sole route", () => {
  it("issues for the one mdpro window with no CDP title bind, and a no-CDP unlabelled consumer submits A's dialog", async () => {
    const dir = await newStore();
    const { producer, token, r, props } = await issued(dir);
    expect(producer.log.join("\n")).toContain("bound label= hwnd=101");
    expect(producer.log.join("\n")).not.toContain("receipt title restored");
    expect(r).toMatchObject({ owner: { hwnd: "101", label: "" } });
    expect(r.expiresMs - r.issuedMs).toBe(30_000);
    const consumer = await consume(dir, { receipt: token }, props);
    expect(consumer.status, consumer.log.join("\n") + consumer.stderr).toBe(0);
    expect(dialogEffects(consumer.trace)).toEqual(submitted);
    expect(await stored(dir)).toEqual([]);
  });

  it("refuses the sole receipt when the consumer names a label, with no write or key", async () => {
    const dir = await newStore();
    const { token, props } = await issued(dir);
    const result = await consume(dir, { receipt: token, window: "A" }, props);
    expect(result.status).toBe(1);
    expect(result.log.join("\n")).toContain("IDENTITY_RECEIPT_LABEL_MISMATCH");
    expect(dialogEffects(result.trace)).toEqual([]);
  });

  it("refuses an unlabelled issue with two unowned mdpro windows, storing nothing and sending no key", async () => {
    const dir = await newStore();
    const producer = await issue(dir, { ...soleScene, secondMdpro: true, dialogs: [fileDialog(602, 202), fileDialog(501, 101)] });
    expect(producer.status).toBe(1);
    expect(producer.log.join("\n")).toContain("IDENTITY");
    expect(tokenOf(producer.log)).toBeUndefined();
    expect(await stored(dir)).toEqual([]);
    expect(effects(producer.trace)).toEqual([]);
  });
});
