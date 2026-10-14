// @vitest-environment node
/**
 * D207: the receiver's test seam MDPRO_HOOK_TEST_LISTEN_LOG_DELAY_MS
 * (receiver.py, "test seam (D177-H5-WI-2)") takes only ASCII digits.
 *
 * It used `str.isdigit()`, which is true for any Unicode digit: `²` passed
 * and then `int("²")` raised, so the receiver died at startup instead of
 * ignoring a bad value, and a full-width `５０００` was read as 5000 ms.
 * A value that is not 1–4 ASCII digits is now ignored like an unset one.
 *
 * Boundary: a real receiver.py child on 127.0.0.1, a temp hook dir, a fake
 * token generated here.
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RECEIVER, fakeToken, freePort, makeTemp, readText, rmTemp, waitFor } from "./support/d177Hooks";

let home: string | undefined;
let child: ChildProcess | undefined;

afterEach(async () => {
  if (child && child.exitCode === null) {
    const exited = new Promise((r) => child!.once("exit", r));
    child.kill("SIGKILL");
    await exited;
  }
  child = undefined;
  rmTemp(home);
  home = undefined;
});

/** Starts the receiver with the seam set to `delay`; resolves once it logs "listening" (or gives up). */
async function start(delay: string): Promise<{ dir: string; port: number; token: string; listenMs: number | null }> {
  home = makeTemp("seam-home");
  const dir = path.join(home, "hookdir");
  fs.mkdirSync(dir);
  const token = fakeToken();
  fs.writeFileSync(path.join(dir, "token"), token + "\n", { mode: 0o600 });
  const port = await freePort();
  const t0 = Date.now();
  child = spawn("python3", [RECEIVER], {
    env: {
      ...process.env,
      HOME: home,
      MDPRO_HOOK_DIR: dir,
      MDPRO_HOOK_BIND: "127.0.0.1",
      MDPRO_HOOK_PORT: String(port),
      MDPRO_HOOK_TEST_LISTEN_LOG_DELAY_MS: delay,
    },
    stdio: "ignore",
  });
  const log = path.join(dir, "receiver.log");
  const line = `listening on 127.0.0.1:${port}`;
  const ok = await waitFor(() => child!.exitCode === null && readText(log).includes(line), 8000);
  return { dir, port, token, listenMs: ok ? Date.now() - t0 : null };
}

async function post(port: number, token: string): Promise<number> {
  const res = await fetch(`http://127.0.0.1:${port}/hook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Mdpro-Token": token },
    body: JSON.stringify({ hook_event_name: "Stop", session_id: "s-1" }),
  });
  return res.status;
}

describe("D207 the listen-log delay seam accepts ASCII digits only", () => {
  it("s1: a Unicode digit that int() rejects (²) is ignored; the receiver starts and serves", async () => {
    const { port, token, listenMs } = await start("²");
    expect(child!.exitCode, "the receiver is still running").toBe(null);
    expect(listenMs, "the listening line was written").not.toBe(null);
    expect(await post(port, token)).toBe(200);
  }, 15_000);

  it("s2: full-width digits (５０００) are ignored, not read as a 5 s delay", async () => {
    const { port, token, listenMs } = await start("５０００");
    expect(listenMs, "the listening line was written").not.toBe(null);
    expect(listenMs!, "no 5 s delay was applied").toBeLessThan(3000);
    expect(await post(port, token)).toBe(200);
  }, 15_000);

  it("s3 control: ASCII digits still delay the listening line", async () => {
    const { listenMs } = await start("1500");
    expect(listenMs, "the listening line was written").not.toBe(null);
    expect(listenMs!).toBeGreaterThanOrEqual(1400);
  }, 15_000);
});
