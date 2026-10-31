// @vitest-environment node
/**
 * D336 F7 (with F4's receipt half): a scoped modal-owner receipt bridges modal entry. The
 * producer run binds A through the CDP title challenge, pins a receipt-only window property on A,
 * restores A's title before the modal opens, and stores the receipt on the host keyed by the
 * token's hash. A separate invocation with no CDP at all consumes it from native observations
 * only: exactly once, before expiry at 30000 ms (29999 is live, 30000 is not), while A still
 * carries the pin. A replacement invalidates the older receipt; a forged, edited, reused or
 * expired token, or a failed title restore, authorizes nothing. Production ui.ps1 under pwsh
 * with Win32 doubles only; the store is a real directory.
 */
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { effects, fileDialog, identity, runDialog } from "./windows-driver-native-dialog-harness";

vi.setConfig({ testTimeout: 60_000 });

const PATH = "C:\\audit\\测试 a.md";
const both = () => [fileDialog(602, 202), fileDialog(501, 101)];
const dialogEffects = (trace: string[]) => effects(trace).filter((line) => !line.startsWith("key-hwnd:101:"));
const submitted = [`dialog-write:5012:12:${PATH}`, "key-hwnd:501:13:0", "key-hwnd:501:13:2", "dialog-submit:501"];
interface Stored { owner: { hwnd: string; label: string }; pinKey: string; pinValue: string; issuedMs: number; expiresMs: number }

const newStore = async () => path.join(await mkdtemp(path.join(os.tmpdir(), "mdpro-receipts-")), "store");
const stored = async (dir: string) => (await readdir(dir).catch(() => [] as string[])).filter((name) => name.endsWith(".json"));
const record = async (dir: string): Promise<Stored> => JSON.parse(await readFile(path.join(dir, (await stored(dir))[0]), "utf8"));
const tokenOf = (log: string[]) => /^receipt ([a-f0-9]{64})$/m.exec(log.join("\n"))?.[1];

async function issue(dir: string, options: { unbindFails?: boolean } = {}) {
  return runDialog([
    { op: "dialogReceipt", window: "A", _identity: identity },
    { op: "chord", window: "A", keys: ["ctrl+o"], _identity: identity },
  ], { dialogs: both(), dialogOpensOn: "chord", dialogForeground: 501 }, { receiptDir: dir, ...options });
}
/** A fresh invocation: no CDP endpoint, and A carries whatever pins `props` names. */
function consume(dir: string, receipt: unknown, props: Record<string, string>, receiptNow?: number) {
  return runDialog([{ op: "filedialog", receipt, path: PATH }],
    { dialogs: both(), dialogForeground: 501, ownerProps: props }, { receiptDir: dir, noCdp: true, receiptNow });
}
const pinOf = (r: Stored) => ({ [r.pinKey]: r.pinValue });
/** Issues one receipt and asserts it exists before any case reads it. */
async function issued(dir: string) {
  const producer = await issue(dir);
  expect(producer.status, producer.log.join("\n") + producer.stderr).toBe(0);
  const token = tokenOf(producer.log);
  expect(token).toMatch(/^[a-f0-9]{64}$/);
  expect(await stored(dir)).toHaveLength(1);
  return { token: token as string, r: await record(dir) };
}

describe("D336 F7 a scoped receipt bridges modal entry without parent CDP", () => {
  it("is issued before modal entry with A's title restored, and a separate no-CDP invocation consumes it once, A only", async () => {
    const dir = await newStore();
    const producer = await issue(dir);
    expect(producer.status, producer.log.join("\n") + producer.stderr).toBe(0);
    const token = tokenOf(producer.log);
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(producer.title).toBe("mdpro");
    const issued = producer.log.findIndex((line) => /^receipt [a-f0-9]{64}$/.test(line));
    expect(issued).toBeGreaterThan(producer.log.findIndex((line) => line === "receipt title restored label=A"));
    expect(issued).toBeLessThan(producer.log.findIndex((line) => line.startsWith("chord ")));
    expect(await stored(dir)).toHaveLength(1);
    const raw = await readFile(path.join(dir, (await stored(dir))[0]), "utf8");
    expect(raw).not.toContain(token);
    const r = await record(dir);
    expect(r).toMatchObject({ owner: { hwnd: "101", label: "A" } });
    expect(r.expiresMs - r.issuedMs).toBe(30_000);

    const consumer = await consume(dir, token, pinOf(r));
    expect(consumer.status, consumer.log.join("\n") + consumer.stderr).toBe(0);
    expect(dialogEffects(consumer.trace)).toEqual(submitted);
    expect(consumer.log.join("\n")).toContain("dialog owner=101 dialog=501 control=5012");
    expect(consumer.trace).toContain("property:remove");
    expect(await stored(dir)).toEqual([]);

    const again = await consume(dir, token, pinOf(r));
    expect(again.status).toBe(1);
    expect(again.log.join("\n")).toContain("IDENTITY_RECEIPT_INVALID");
    expect(dialogEffects(again.trace)).toEqual([]);
  });

  it("refuses a forged, edited, malformed or missing token with no write or key, and keeps the live receipt", async () => {
    const dir = await newStore();
    const { token, r } = await issued(dir);
    const edited = (token[0] === "a" ? "b" : "a") + token.slice(1);
    for (const receipt of ["f".repeat(64), edited, token.toUpperCase(), "abc", 42, ""]) {
      const result = await consume(dir, receipt, pinOf(r));
      expect(result.status, String(receipt)).toBe(1);
      expect(result.log.join("\n")).toContain("IDENTITY_RECEIPT_INVALID");
      expect(dialogEffects(result.trace)).toEqual([]);
      expect(result.outcome).toMatchObject({ status: "failed", inputOutcome: "none" });
    }
    expect(await stored(dir)).toHaveLength(1);
  });

  it("is live at 29999 ms and expired at exactly 30000 ms, and an expired receipt is invalidated", async () => {
    const live = await newStore();
    const { token: liveToken, r: liveRecord } = await issued(live);
    const ok = await consume(live, liveToken, pinOf(liveRecord), liveRecord.issuedMs + 29_999);
    expect(ok.status, ok.log.join("\n")).toBe(0);
    expect(dialogEffects(ok.trace)).toEqual(submitted);

    const dead = await newStore();
    const { token: deadToken, r: deadRecord } = await issued(dead);
    const expired = await consume(dead, deadToken, pinOf(deadRecord), deadRecord.issuedMs + 30_000);
    expect(expired.status).toBe(1);
    expect(expired.log.join("\n")).toContain("IDENTITY_RECEIPT_EXPIRED");
    expect(dialogEffects(expired.trace)).toEqual([]);
    expect(await stored(dead)).toEqual([]);
  });

  it("a replacement receipt for the same owner invalidates the older one", async () => {
    const dir = await newStore();
    const { token: first } = await issued(dir);
    const { token: second, r } = await issued(dir);
    expect(second).not.toBe(first);
    const old = await consume(dir, first, pinOf(r));
    expect(old.log.join("\n")).toContain("IDENTITY_RECEIPT_INVALID");
    expect(dialogEffects(old.trace)).toEqual([]);
    const current = await consume(dir, second, pinOf(r));
    expect(current.status, current.log.join("\n")).toBe(0);
  });

  it("refuses when A no longer carries the receipt's pin, and the receipt is used up", async () => {
    const dir = await newStore();
    const { token } = await issued(dir);
    const result = await consume(dir, token, {});
    expect(result.status).toBe(1);
    expect(result.log.join("\n")).toContain("IDENTITY_WINDOW_LIFETIME");
    expect(dialogEffects(result.trace)).toEqual([]);
    expect(await stored(dir)).toEqual([]);
  });

  it("two simultaneous consumers of one receipt: exactly one writes and submits", async () => {
    const dir = await newStore();
    const { token, r } = await issued(dir);
    const results = await Promise.all([consume(dir, token, pinOf(r)), consume(dir, token, pinOf(r))]);
    expect(results.map((x) => x.status).sort()).toEqual([0, 1]);
    expect(results.flatMap((x) => dialogEffects(x.trace))).toEqual(submitted);
    expect(results.find((x) => x.status === 1)!.log.join("\n")).toContain("IDENTITY_RECEIPT_INVALID");
  });

  it("a failed title restore issues no receipt and enters no modal", async () => {
    const dir = await newStore();
    const producer = await issue(dir, { unbindFails: true });
    expect(producer.status).toBe(1);
    expect(tokenOf(producer.log)).toBeUndefined();
    expect(producer.log.join("\n")).toContain("IDENTITY_TITLE_RESTORE_FAILED");
    expect(await stored(dir)).toEqual([]);
    expect(producer.trace.some((line) => line.startsWith("dialog-open:"))).toBe(false);
  });
});
