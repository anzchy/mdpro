// @vitest-environment node
/**
 * D248 — on Windows (Node 24) `cdp.mjs` aborted in libuv after printing the right answer
 * (`Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`, exit 0xC0000409) whenever it probed
 * several pages: it called `ws.close()` and then `process.exit()` while the sockets were still
 * closing. Now every exit path (done, fail(), CDP_TIMEOUT) closes each socket it opened and waits
 * for the close before exiting, so each connection ends with a close frame.
 *
 * The abort itself does not reproduce on macOS; these tests pin the shutdown on the fake DevTools
 * endpoint (tests/support/fakeCdp.ts), and the device check on win-desktop proves the crash is gone.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startFakeCdp, type FakeCdp, type FakePage } from "../support/fakeCdp";

const CDP = path.resolve(__dirname, "../../.claude/skills/remote-windows-device-test/scripts/windows/cdp.mjs");

const servers: FakeCdp[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await s.close();
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

async function run(pages: FakePage[], args: string[], env: Record<string, string> = {}) {
  const s = await startFakeCdp(pages);
  servers.push(s);
  const r = await cdp(s.port, env, ...args);
  await s.settled();
  return { ...r, connections: s.connections };
}

/** Every socket the client opened ended with its close frame, never a dropped TCP connection. */
function expectAllClosedCleanly(connections: { page: string; closeFrame: boolean; ended: boolean }[]) {
  expect(connections.length).toBeGreaterThan(0);
  for (const c of connections) {
    expect(c.ended, `${c.page}: connection ended`).toBe(true);
    expect(c.closeFrame, `${c.page}: close frame before the end`).toBe(true);
  }
}

describe("D248 — cdp.mjs closes every socket before it exits", () => {
  it("X0 --window over two pages: exit 0, the answer printed, the two probes and the eval socket all closed", async () => {
    const r = await run([page("p1", "main"), page("p2", "mdpro-abc")], ["--window", "mdpro-abc", "eval", "1"]);
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout)).toBe("p2");
    expect(r.connections).toHaveLength(3);
    expectAllClosedCleanly(r.connections);
  });

  it("X5 a label no page has: exit 5, both probe sockets closed", async () => {
    const r = await run([page("p1", "main"), page("p2", "mdpro-abc")], ["--window", "nope", "eval", "1"]);
    expect(r.status).toBe(5);
    expect(JSON.parse(r.stdout).error).toBe("WINDOW_NOT_FOUND");
    expectAllClosedCleanly(r.connections);
  });

  it("X6 two pages and no label: exit 6, both probe sockets closed", async () => {
    const r = await run([page("p1", "main"), page("p2", "mdpro-abc")], ["eval", "1"]);
    expect(r.status).toBe(6);
    expectAllClosedCleanly(r.connections);
  });

  it("X5b WINDOW_MISMATCH on the eval's own socket: exit 5, every socket closed", async () => {
    let probes = 0;
    const r = await run(
      [
        {
          id: "p1",
          evaluate: (e) => (isProbe(e) ? { result: { type: "string", value: (probes += 1) === 1 ? "main" : "other" } } : undefined),
        },
      ],
      ["--window", "main", "eval", "1"],
    );
    expect(r.status).toBe(5);
    expectAllClosedCleanly(r.connections);
  });

  it("X1 a protocol error (fail 1, CDP_ERROR): every socket closed", async () => {
    const destroyed = { code: -32000, message: "Execution context was destroyed." };
    const r = await run(
      [page("p1", "main", { error: (m, e) => (m === "Runtime.evaluate" && isUserEval(e) ? destroyed : undefined) })],
      ["eval", "1"],
    );
    expect(r.status).toBe(1);
    expectAllClosedCleanly(r.connections);
  });

  it("X3 CDP_TIMEOUT: an eval that never answers exits 3 and still closes its socket", async () => {
    const r = await run([page("p1", "main", { hang: (m, e) => m === "Runtime.evaluate" && isUserEval(e) })], ["eval", "1"], {
      MDPRO_CDP_TIMEOUT_MS: "400",
    });
    expect(r.status).toBe(3);
    expect(r.stdout).toContain("CDP_TIMEOUT");
    expectAllClosedCleanly(r.connections);
  });
});

describe("D248 — cdp.mjs exits only through end(), once a socket may be open (source guard)", () => {
  it("X9 process.exit appears only before any socket opens (port closed, no page) and inside end()", async () => {
    const fs = await import("node:fs");
    const lines = fs.readFileSync(CDP, "utf8").split("\n");
    const exits = lines.filter((l) => l.includes("process.exit(") && !/^\s*\/\//.test(l));
    expect(exits.length).toBeGreaterThan(0);
    for (const l of exits) expect(l, l).toMatch(/CDP_PORT_CLOSED|no page starting with|^const end = /);
  });
});
