// @vitest-environment node
/**
 * WI-E2E-W — `scripts/windows/cdp.mjs`, the page client, run with node against a fake DevTools
 * endpoint (tests/support/fakeCdp.ts). An eval that throws must exit non-zero (rev3 N1): before,
 * it printed the exception and exited 0, so `cdp.sh eval … && next` ran `next` anyway.
 *
 * Mocked: the DevTools endpoint only.
 */
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startFakeCdp, type FakeCdp, type FakePage } from "../support/fakeCdp";

const CDP = path.resolve(__dirname, "../../.claude/skills/remote-windows-device-test/scripts/windows/cdp.mjs");

const servers: FakeCdp[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await s.close();
});

/** The user's expression is the one wrapped in an async function; the rest is cdp.mjs's own. */
const isUserEval = (e: string) => e.startsWith("(async () =>");

function cdp(port: number, ...args: string[]): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [CDP, ...args], { env: { ...process.env, MDPRO_CDP_PORT: String(port) } });
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => (stderr += d));
    p.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

async function serve(pages: FakePage[]) {
  const s = await startFakeCdp(pages);
  servers.push(s);
  return s;
}

describe("cdp.mjs — exit codes", () => {
  it("C1 an eval exception prints the JSON and exits 1", async () => {
    const s = await serve([
      {
        id: "p1",
        evaluate: (e) =>
          isUserEval(e)
            ? { result: { type: "object" }, exceptionDetails: { text: "Uncaught", exception: { description: "ReferenceError: nope" } } }
            : undefined,
      },
    ]);
    const r = await cdp(s.port, "eval", "nope");
    expect(r.status, r.stderr).toBe(1);
    expect(JSON.parse(r.stdout)).toEqual({ exception: "ReferenceError: nope" });
  });

  it("C1b control: a value exits 0", async () => {
    const s = await serve([{ id: "p1", evaluate: (e) => (isUserEval(e) ? { result: { type: "number", value: 42 } } : undefined) }]);
    const r = await cdp(s.port, "eval", "42");
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout)).toBe(42);
  });

  it("C5 a closed port exits 4", async () => {
    const port = await new Promise<number>((resolve) => {
      const srv = net.createServer().listen(0, "127.0.0.1", () => {
        const p = (srv.address() as net.AddressInfo).port;
        srv.close(() => resolve(p));
      });
    });
    const r = await cdp(port, "eval", "1");
    expect(r.status).toBe(4);
    expect(r.stdout).toContain("CDP_PORT_CLOSED");
  });
});
