// @vitest-environment node
/**
 * GH727 AC-5 (#728): when the native driver leaves no readable out.json, runNative says why — the exit code, the
 * signal, the stderr and stdout tails, the temp dir and the artifacts it kept — instead of a bare ENOENT.
 * A fake `pwsh` first on PATH plays each failure; its mode comes from FAKE_PWSH_MODE.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { spawnBudget } from "../support/spawnBudget";
import { runNative } from "./windows-driver-native-harness";
import { readNativeReport, type NativeRun } from "./windows-driver-native-report";

// A passthrough spy: each run's outcome as runNative hands it to the report reader, which then reads it unchanged.
vi.mock("./windows-driver-native-report", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./windows-driver-native-report")>();
  return { ...actual, readNativeReport: vi.fn(actual.readNativeReport) };
});

const bin = fs.mkdtempSync(path.join(os.tmpdir(), "gh727-pwsh-"));
const priorPath = process.env.PATH;
beforeAll(() => {
  fs.writeFileSync(path.join(bin, "pwsh"), `#!/bin/sh
out=""
while [ $# -gt 0 ]; do [ "$1" = "-Out" ] && out="$2"; shift; done
case "$FAKE_PWSH_MODE" in
  fail) echo boom >&2; echo partial; exit 3 ;;
  kill) kill -KILL $$ ;;
  quiet) echo quiet >&2; exit 0 ;;
  ok) printf '["ok"]' > "$out"; exit 0 ;;
  flood) head -c 100000 /dev/zero | tr '\\0' x >&2; printf '\\nFINAL-MARKER\\n' >&2; exit 2 ;;
  soak) head -c 100000 /dev/zero | tr '\\0' y; printf '\\nOUT-MARKER\\n'; exit 2 ;;
  truncated) printf '["ok"' > "$out"; echo halfway >&2; exit 1 ;;
esac
exit 9
`, { mode: 0o755 });
  process.env.PATH = `${bin}:${priorPath ?? ""}`;
});
afterAll(() => {
  process.env.PATH = priorPath;
  delete process.env.FAKE_PWSH_MODE;
  fs.rmSync(bin, { recursive: true, force: true });
});

/** The rejection message of a run in `mode`, or "resolved" when it did not reject. */
async function failure(mode: string): Promise<string> {
  process.env.FAKE_PWSH_MODE = mode;
  try {
    await runNative([]);
    return "resolved";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

describe("GH727 runNative without a readable out.json", () => {
  it("reports the exit code, signal, both tails, the temp dir and the retained artifacts", async () => {
    const message = await failure("fail");
    const dir = /mdpro-native-dispatch-[^\s/]+/.exec(message)?.[0] ?? "";
    expect([
      message.includes("exit code 3"), message.includes("signal null"), message.includes("boom"), message.includes("partial"),
      dir !== "", ["ui-test.ps1", "steps.json", "trace.txt"].every((name) => message.includes(`${dir}/${name}`)),
    ]).toEqual([true, true, true, true, true, true]);
  }, spawnBudget(3_160));

  it("names the signal when the driver is killed before it writes", async () => {
    const message = await failure("kill");
    expect([message.includes("signal SIGKILL"), message.includes("exit code null")]).toEqual([true, true]);
  }, spawnBudget(3_160));

  it("reports a clean exit that wrote nothing", async () => {
    const message = await failure("quiet");
    expect([message.includes("exit code 0"), message.includes("signal null"), message.includes("quiet"), /mdpro-native-dispatch-/.test(message)])
      .toEqual([true, true, true, true]);
  }, spawnBudget(3_160));

  it("names artifacts by absolute paths that exist", async () => {
    const message = await failure("fail");
    const listed = (/^artifacts: (.*)$/m.exec(message)?.[1] ?? "").split(", ");
    expect(listed.map((file) => [path.basename(file), path.isAbsolute(file) && fs.existsSync(file)]))
      .toEqual([["ui-test.ps1", true], ["steps.json", true], ["trace.txt", true]]);
  }, spawnBudget(3_160));

  it("still resolves a run that wrote its report", async () => {
    process.env.FAKE_PWSH_MODE = "ok";
    const run = await runNative([]);
    expect([run.status, run.log]).toEqual([0, ["ok"]]);
  }, spawnBudget(3_160));

  it("keeps only the last 2 000 characters of a flood of stderr, ending with its final line", async () => {
    const message = await failure("flood");
    const stderrTail = /stderr tail:\n([\s\S]*?)\nstdout tail:/.exec(message)?.[1] ?? "";
    expect([stderrTail.length, stderrTail.trimEnd().endsWith("FINAL-MARKER"), message.length < 6_000]).toEqual([2_000, true, true]);
  }, spawnBudget(3_160));

  it("keeps a rolling 2 000-character stdout tail, not the whole stream (R1-M2)", async () => {
    const message = await failure("soak");
    const run = vi.mocked(readNativeReport).mock.lastCall?.[0] as NativeRun;
    expect([run.stdout.length <= 2_000, run.stdout.trimEnd().endsWith("OUT-MARKER"), message.includes("OUT-MARKER")]).toEqual([true, true, true]);
  }, spawnBudget(3_160));

  it("reports a truncated report as unreadable, with the same exit, tails and artifacts", async () => {
    const message = await failure("truncated");
    expect([
      message.includes("unreadable report"), message.includes("exit code 1"), message.includes("halfway"),
      /^artifacts: .*\/out\.json/m.test(message), message.startsWith("Unexpected"),
    ]).toEqual([true, true, true, true, false]);
  }, spawnBudget(3_160));
});
