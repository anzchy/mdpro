// @vitest-environment node
/**
 * D82-WI-6 (M5): the real `ps` behind `scanVerifyPids`.
 * PF-M5-0 pins what macOS `ps -o comm=` prints (the spawned path string,
 * and `argv0` when one is set), which finding 11 turns into the comm-vs-
 * fallback choice. PF-M5-R1/R2 are the real-path pairings for the parser
 * cases in `control-launcher-procfacts-argv.test.ts`.
 * Matrix: `.claude/tdd-guardian/tests-20261010-103136.md`, D82-WI-6 and
 * "Round 3 additions" (gap R2-3, row 2 pinned).
 */
import { execFileSync, spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { scanVerifyPids } from "../../scripts/control/procFacts.mjs";

const TAIL = ["mdpro-verify.app", "Contents", "MacOS", "tauri-app"];
const isRoot = process.getuid?.() === 0;
const darwinUser = process.platform !== "darwin" || isRoot;

let disposers: (() => void)[] = [];
afterEach(() => {
  for (const d of disposers.reverse()) d();
  disposers = [];
});

/** A fresh tmp dir, deliberately NOT realpathed (`/var/folders/…` on macOS). */
function tmpDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "pfm5-"));
  disposers.push(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
}

/** `/bin/sleep` copied to `<tmp>/a b/mdpro-verify.app/Contents/MacOS/tauri-app`. */
function spacedVerifyBin(): string {
  const dir = path.join(tmpDir(), "a b", ...TAIL.slice(0, -1));
  fs.mkdirSync(dir, { recursive: true });
  const bin = path.join(dir, TAIL[TAIL.length - 1]);
  fs.copyFileSync("/bin/sleep", bin);
  fs.chmodSync(bin, 0o755);
  return bin;
}

async function start(cmd: string, args: string[], opts: SpawnOptions = {}): Promise<number> {
  const child: ChildProcess = spawn(cmd, args, { stdio: "ignore", ...opts });
  disposers.push(() => child.kill("SIGKILL"));
  await new Promise<void>((res, rej) => {
    child.once("spawn", () => res());
    child.once("error", rej);
  });
  return child.pid as number;
}

const comm = (pid: number): string =>
  execFileSync("ps", ["-p", String(pid), "-o", "comm="], { env: { ...process.env, LC_ALL: "C" } })
    .toString()
    .trim();

describe("D82-WI-6 the real verify scan", () => {
  it.skipIf(darwinUser)("PF-M5-0 comm prints the spawned path string; with argv0 set it prints argv0", async () => {
    const bin = spacedVerifyBin();
    const row1 = comm(await start(bin, ["30"]));
    const row2 = comm(await start(bin, ["30"], { argv0: "x" }));
    expect(row1).toBe(bin);
    expect([bin, "x"], `comm with argv0=x printed ${row2}`).toContain(row2);
    // Observed 2026-10-10 on macOS (Darwin 25.3.0): row 2 printed "x".
    expect(row2 === bin ? "path" : row2 === "x" ? "argv0" : row2).toBe("argv0");
  });

  it("PF-M5-R1 a process with the verify path only in its arguments is not in the scan", async () => {
    const mention = path.join(tmpDir(), ...TAIL);
    const pid = await start(process.execPath, ["-e", "setTimeout(()=>{},10000)", mention]);
    const s: unknown = await scanVerifyPids();
    const arr = Array.isArray(s);
    expect({ arr, has: arr && (s as number[]).includes(pid) }).toEqual({ arr: true, has: false });
  });

  it.skipIf(darwinUser)("PF-M5-R2 a real verify-named executable in a spaced directory is in the scan", async () => {
    const pid = await start(spacedVerifyBin(), ["30"]);
    const s: unknown = await scanVerifyPids();
    const arr = Array.isArray(s);
    expect({ arr, has: arr && (s as number[]).includes(pid) }).toEqual({ arr: true, has: true });
  });
});
