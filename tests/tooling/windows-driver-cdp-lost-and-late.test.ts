// @vitest-environment node
/**
 * D248-WI-4 (audit b174 Mediums 1–3): the drain fix let three shutdowns report the wrong outcome.
 *
 * M1 A socket that drops, or never opens, left main() pending with no handles: the loop drained
 *    with no exit code and the run "passed" with 0. Now a lost connection prints
 *    CDP_CONNECTION_LOST and exits 3, the code for "the eval may have run".
 * M2 An answer that arrived just before CDP_TIMEOUT was followed by CDP_TIMEOUT on stdout while
 *    end() waited for the closes. Now end() clears the timer first.
 * M3 A /json/list that failed after the timeout exited 4, overriding the 3. Now the list fetch is
 *    inside main() and end() keeps the first code; a late failure prints nothing.
 */
import { spawn } from "node:child_process";
import http from "node:http";
import type { AddressInfo, Socket } from "node:net";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startFakeCdp, type FakeCdp, type FakePage } from "../support/fakeCdp";

const CDP = path.resolve(__dirname, "../../.claude/skills/remote-windows-device-test/scripts/windows/cdp.mjs");

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

function cdp(port: number, env: Record<string, string>, ...args: string[]) {
  return new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve) => {
    const p = spawn(process.execPath, [CDP, ...args], { env: { ...process.env, MDPRO_CDP_PORT: String(port), ...env } });
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => (stderr += d));
    p.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

const isUserEval = (e: string) => e.startsWith("(async () =>");
const isProbe = (e: string) => e.includes("__TAURI_INTERNALS__");
const page = (id: string, label: string, extra: Partial<FakePage> = {}): FakePage => ({
  id,
  evaluate: (e) =>
    isProbe(e) ? { result: { type: "string", value: label } } : isUserEval(e) ? { result: { type: "string", value: id } } : undefined,
  ...extra,
});

async function fake(pages: FakePage[], closeReplyDelayMs?: number) {
  const s: FakeCdp = await startFakeCdp(pages, { closeReplyDelayMs });
  cleanups.push(() => s.close());
  return s;
}

describe("D248-WI-4 M1 — a lost connection is exit 3, never a silent 0", () => {
  it("L1 the socket drops on the user's eval: exit 3, CDP_CONNECTION_LOST", async () => {
    const s = await fake([page("p1", "main", { drop: (m, e) => m === "Runtime.evaluate" && isUserEval(e) })]);
    const r = await cdp(s.port, {}, "eval", "1");
    expect(r.status, r.stderr).toBe(3);
    expect(JSON.parse(r.stdout).error).toBe("CDP_CONNECTION_LOST");
  });

  it("L2 the socket drops during a window probe: exit 3", async () => {
    const s = await fake([page("p1", "main", { drop: (_m, e) => isProbe(e) }), page("p2", "mdpro-abc")]);
    const r = await cdp(s.port, {}, "--window", "mdpro-abc", "eval", "1");
    expect(r.status, r.stderr).toBe(3);
    expect(r.stdout).toContain("CDP_CONNECTION_LOST");
  });

  it("L3 the socket never opens: exit 3", async () => {
    const s = await fake([page("p1", "main", { refuseUpgrade: true })]);
    const r = await cdp(s.port, {}, "eval", "1");
    expect(r.status, r.stderr).toBe(3);
    expect(r.stdout).toContain("CDP_CONNECTION_LOST");
  });
});

describe("D248-WI-4 M2 — an answer before the timeout is not followed by CDP_TIMEOUT", () => {
  it("L4 the timer would fire while end() waits for the close: exit 0, the answer, no CDP_TIMEOUT", async () => {
    const s = await fake([page("p1", "main")], 600);
    const r = await cdp(s.port, { MDPRO_CDP_TIMEOUT_MS: "300" }, "eval", "1");
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout)).toBe("p1");
    expect(r.stdout).not.toContain("CDP_TIMEOUT");
  });
});

describe("D248-WI-4 M3 — a /json/list failure after CDP_TIMEOUT keeps the 3", () => {
  it("L5 /json/list hangs past the timeout, then its connection drops: exit 3, never 4", async () => {
    const held = new Set<Socket>();
    const server = http.createServer((req) => {
      const sock = req.socket;
      held.add(sock);
      setTimeout(() => sock.destroy(), 600);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    cleanups.push(
      () =>
        new Promise<void>((resolve) => {
          for (const s of held) s.destroy();
          server.close(() => resolve());
        }),
    );
    const r = await cdp((server.address() as AddressInfo).port, { MDPRO_CDP_TIMEOUT_MS: "300" }, "eval", "1");
    expect(r.status, r.stderr).toBe(3);
    expect(r.stdout).toContain("CDP_TIMEOUT");
    expect(r.stdout).not.toContain("CDP_PORT_CLOSED");
  });
});
