// @vitest-environment node
/**
 * D337 T3 on the D336 dialog path: WM_SETTEXT to a hung dialog cannot be interrupted in the
 * worker, so the supervisor's progress bound must end it. The run comes out nonzero within the
 * transaction, names phase input:dialog-path, reports that input was touched (partial or
 * unknown, never none), sends no Enter, and leaves no owned process behind. The production
 * worker runs under the real supervisor with doubles at the OS boundary only.
 */
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { fileDialog } from "./windows-driver-native-dialog-harness";
import { productionWorkerFixture } from "./windows-driver-native-production-harness";

vi.setConfig({ testTimeout: 40_000 });

const outcome = (lines: string[]) => JSON.parse(lines.filter((v) => v.startsWith("OUTCOME ")).at(-1)!.slice(8));
function alive(pid: number) { try { process.kill(pid, 0); return true; } catch { return false; } }
async function exists(file: string) { try { await access(file); return true; } catch { return false; } }
const PATH = "C:\\audit\\a.md";
const scenario = { dialogs: [fileDialog(501, 101)], dialogForeground: 501 };

describe("D337 T3 a filename-write stall on the dialog path", () => {
  it("the control: the same production route writes, submits and completes without a stall", async () => {
    const fixture = await productionWorkerFixture("none", [{ op: "filedialog", path: PATH }], { scenario });
    const result = await fixture.start().result;
    expect(result.status, result.stderr + result.lines.join(" ")).toBe(0);
    expect((await fixture.traceLines()).filter((line) => /^dialog-(write|submit):/.test(line)))
      .toEqual([`dialog-write:5012:12:${PATH}`, "dialog-submit:501"]);
  });

  it("is ended by the supervisor in phase input:dialog-path, nonzero, input touched, no Enter", async () => {
    const fixture = await productionWorkerFixture("dialog-write", [{ op: "filedialog", path: PATH }], { scenario });
    const started = Date.now();
    const result = await fixture.start().result;
    expect(result.status, result.stderr + result.lines.join(" ")).not.toBe(0);
    expect(Date.now() - started).toBeLessThan(30_000);
    const value = outcome(result.lines);
    expect(value.phase).toContain("input:dialog-path");
    expect(value.status).toBe("failed");
    expect(["partial", "unknown"]).toContain(value.inputOutcome);
    const trace = await fixture.traceLines();
    expect(trace).toContain(`dialog-write:5012:12:${PATH}`);
    expect(trace.filter((line) => /^key-hwnd:501:13:|^dialog-submit:/.test(line))).toEqual([]);
    const members = (await readFile(path.join(fixture.dir, "members"), "utf8")).trim().split("\n").map(Number);
    expect(members.length).toBeGreaterThan(0);
    expect(members.every((pid) => !alive(pid))).toBe(true);
    expect(await exists(path.join(fixture.dir, "task"))).toBe(false);
    const durable = JSON.parse(await readFile(path.join(fixture.dir, "runs", fixture.runId, "result.json"), "utf8"));
    expect(durable).toMatchObject({ runId: fixture.runId, phase: value.phase });
    expect(durable.inputOutcome).not.toBe("none");
  });
});
