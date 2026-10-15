// @vitest-environment node
/**
 * D177-H5-WI-2: the receiver writes "listening on <host>:<port>" before it
 * accepts connections, so a client that connects can rely on the log line.
 *
 * Today main() builds ThreadingHTTPServer (bind + listen) and only then logs,
 * so a connect can succeed before the line exists: the cause of a one-in-118
 * flake of h4-log-fields m4 under the Python 3.9 shim. The env-gated seam
 * MDPRO_HOOK_TEST_LISTEN_LOG_DELAY_MS (receiver.py, "test seam
 * (D177-H5-WI-2)") sleeps just before the log line, which turns that window
 * into 1.5 s, so the race fails every run instead of rarely. With the order
 * fixed (bind → log → listen) connects are refused until the line is written,
 * and the same test passes with the delay still set.
 *
 * The shared fixture treats a successful connect as ready, which is the
 * assumption under test, so this file spawns the receiver itself.
 * Boundary: a real receiver.py child on 127.0.0.1, a temp hook dir, a fake
 * token generated here.
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RECEIVER, fakeToken, freePort, makeTemp, readText, rmTemp } from "../support/d177Hooks";

const DELAY_MS = 1500;
const CONNECT_WAIT_MS = 5000;

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

function tryConnect(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ host: "127.0.0.1", port });
    sock.once("connect", () => {
      sock.destroy();
      resolve(true);
    });
    sock.once("error", () => resolve(false));
  });
}

describe("D177-H5 receiver startup order", () => {
  it("s1: at the first successful connect the listening line is already in the log", async () => {
    home = makeTemp("order-home");
    const dir = path.join(home, "hookdir");
    fs.mkdirSync(dir);
    const token = fakeToken();
    fs.writeFileSync(path.join(dir, "token"), token + "\n", { mode: 0o600 });
    const port = await freePort();
    child = spawn("python3", [RECEIVER], {
      env: {
        ...process.env,
        HOME: home,
        MDPRO_HOOK_DIR: dir,
        MDPRO_HOOK_BIND: "127.0.0.1",
        MDPRO_HOOK_PORT: String(port),
        MDPRO_HOOK_TEST_LISTEN_LOG_DELAY_MS: String(DELAY_MS),
      },
      stdio: "ignore",
    });
    const log = path.join(dir, "receiver.log");
    const line = `listening on 127.0.0.1:${port}`;

    const deadline = Date.now() + CONNECT_WAIT_MS;
    let connected = false;
    while (!connected && Date.now() < deadline && child.exitCode === null) {
      connected = await tryConnect(port);
      if (!connected) await new Promise((r) => setTimeout(r, 20));
    }
    const logAtConnect = readText(log);
    expect(connected, "a connect succeeded within 5 s").toBe(true);
    expect(logAtConnect.includes(line), "listening line present at the first successful connect").toBe(true);

    const res = await fetch(`http://127.0.0.1:${port}/hook`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Mdpro-Token": token },
      body: JSON.stringify({ hook_event_name: "Stop", session_id: "s-1" }),
    });
    expect(res.status).toBe(200);
    expect(readText(path.join(dir, "events.jsonl")).split("\n").filter((l) => l !== "")).toHaveLength(1);
  }, 15_000);
});
