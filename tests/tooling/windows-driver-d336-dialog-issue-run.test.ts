// @vitest-environment node
/**
 * D336 F7 on the production path: the run that issues a receipt goes through the real supervisor
 * (ui-run.ps1 and its native entry validation) and the production worker, sole route, then opens
 * the modal by chord. It completes, prints only the token, and leaves nothing that could act
 * later: every owned process is gone, no task and no session latch remain, held input is
 * released, and the store holds one inert record and no temporary file. A separate no-CDP
 * invocation then consumes that receipt. Doubles stay at the OS boundary only.
 */
import { access, mkdtemp, readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { effects, fileDialog, runDialog } from "./windows-driver-native-dialog-harness";
import { productionWorkerFixture } from "./windows-driver-native-production-harness";

vi.setConfig({ testTimeout: 60_000 });

const PATH = "C:\\audit\\a.md";
const outcome = (lines: string[]) => JSON.parse(lines.filter((v) => v.startsWith("OUTCOME ")).at(-1)!.slice(8));
function alive(pid: number) { try { process.kill(pid, 0); return true; } catch { return false; } }
async function exists(file: string) { try { await access(file); return true; } catch { return false; } }
const tokenOf = (lines: string[]) => /^receipt ([a-f0-9]{64})$/m.exec(lines.join("\n"))?.[1];

describe("D336 F7 the issuing run under the real supervisor", () => {
  it("issues on the sole route, opens the modal and leaves no owned worker, task, latch or held input", async () => {
    const store = path.join(await mkdtemp(path.join(os.tmpdir(), "mdpro-receipts-")), "store");
    const scenario = { dialogs: [fileDialog(501, 101)], dialogOpensOn: "chord", dialogForeground: 501 };
    const fixture = await productionWorkerFixture("none",
      [{ op: "dialogReceipt" }, { op: "chord", keys: ["ctrl+o"] }], { scenario, receiptDir: store });
    const result = await fixture.start().result;
    expect(result.status, result.stderr + result.lines.join(" ")).toBe(0);
    expect(outcome(result.lines)).toMatchObject({ status: "completed", completedSteps: 2, heldInput: "released", cleanup: "complete" });
    const token = tokenOf(result.lines);
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect((await fixture.traceLines()).some((line) => line.startsWith("dialog-open:"))).toBe(true);

    const members = (await readFile(path.join(fixture.dir, "members"), "utf8")).trim().split("\n").map(Number);
    expect(members.length).toBeGreaterThan(0);
    expect(members.every((pid) => !alive(pid))).toBe(true);
    expect(await exists(path.join(fixture.dir, "task"))).toBe(false);
    expect(await exists(path.join(fixture.dir, "native-session-blocked.json"))).toBe(false);

    const entries = await readdir(store);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatch(/^[a-f0-9]{64}\.json$/);
    const record = JSON.parse(await readFile(path.join(store, entries[0]), "utf8"));
    expect(record.owner).toMatchObject({ hwnd: "101", label: "" });
    expect(JSON.stringify(record)).not.toContain(token);

    const consumer = await runDialog([{ op: "filedialog", receipt: token, path: PATH }],
      { secondMdpro: false, dialogs: [fileDialog(501, 101)], dialogForeground: 501, ownerProps: { [record.pinKey]: record.pinValue } },
      { receiptDir: store, noCdp: true });
    expect(consumer.status, consumer.log.join("\n") + consumer.stderr).toBe(0);
    expect(effects(consumer.trace).filter((line) => !line.startsWith("key-hwnd:101:")))
      .toEqual([`dialog-write:5012:12:${PATH}`, "key-hwnd:501:13:0", "key-hwnd:501:13:2", "dialog-submit:501"]);
    expect(await readdir(store)).toEqual([]);
  });
});
