// @vitest-environment node
/**
 * D248 reopened (device re-check, docs/test/20261016-wi-e2e-w-windows-demos.md § 6): on Windows
 * (Node 24) waiting for every socket's `close` event and then calling process.exit still aborts
 * in libuv (UV_HANDLE_CLOSING, 0xC0000409) whenever 2+ WebSockets were opened: the close event
 * fires while libuv is still closing the handle. On the PC, setting process.exitCode and letting
 * the event loop drain exited 0 ×3. So end() now sets the code and returns; the only
 * process.exit after a socket opened is an unref'd fallback timer for a socket that never closes.
 *
 * macOS (Node 22) does not abort either way, so these tests pin the code shape (D1) and that the
 * process really ends by draining, well before the fallback (D2), and that a hung socket still
 * ends with its code, through the fallback (D3). The proof that the abort is gone is the device
 * re-check on win-desktop.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startFakeCdp, type FakeCdp, type FakePage } from "../support/fakeCdp";

const CDP = path.resolve(__dirname, "../../.claude/skills/remote-windows-device-test/scripts/windows/cdp.mjs");
const SRC = fs.readFileSync(CDP, "utf8");

const servers: FakeCdp[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await s.close();
});

function cdp(port: number, ...args: string[]) {
  return new Promise<{ status: number | null; stdout: string; ms: number }>((resolve) => {
    const t0 = Date.now();
    const p = spawn(process.execPath, [CDP, ...args], { env: { ...process.env, MDPRO_CDP_PORT: String(port) } });
    let stdout = "";
    p.stdout.on("data", (d) => (stdout += d));
    p.on("close", (status) => resolve({ status, stdout, ms: Date.now() - t0 }));
  });
}

const isUserEval = (e: string) => e.startsWith("(async () =>");
const isProbe = (e: string) => e.includes("__TAURI_INTERNALS__");
const page = (id: string, label: string): FakePage => ({
  id,
  evaluate: (e) =>
    isProbe(e) ? { result: { type: "string", value: label } } : isUserEval(e) ? { result: { type: "string", value: id } } : undefined,
});

describe("D248 reopened — end() sets the exit code and lets the loop drain", () => {
  it("D1 end() sets process.exitCode; its only process.exit is an unref'd fallback timer; nothing awaits forever at top level", () => {
    const endLine = SRC.split("\n").find((l) => l.startsWith("const end = "));
    expect(endLine, "end() is defined on one line").toBeDefined();
    expect(endLine).toMatch(/process\.exitCode = code/);
    const exits = endLine!.match(/process\.exit\(/g) ?? [];
    expect(exits, "one process.exit in end(), the fallback").toHaveLength(1);
    expect(endLine).toMatch(/setTimeout\(\(\) => process\.exit\(code\), DRAIN_FALLBACK_MS\)\.unref/);
    // A never-settled top-level await would make Node exit 13 once the loop drains.
    expect(SRC).not.toMatch(/new Promise\(\(\) => \{\}\)/);
  });

  it("D2 two pages, --window: exit 0 with the answer, well before the fallback (the loop drained)", async () => {
    const s = await startFakeCdp([page("p1", "main"), page("p2", "mdpro-abc")]);
    servers.push(s);
    const r = await cdp(s.port, "--window", "mdpro-abc", "eval", "1");
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toBe("p2");
    expect(r.ms).toBeLessThan(1500);
  });

  it("D2b two pages and no label: exit 6, drained", async () => {
    const s = await startFakeCdp([page("p1", "main"), page("p2", "mdpro-abc")]);
    servers.push(s);
    const r = await cdp(s.port, "eval", "1");
    expect(r.status).toBe(6);
    expect(r.ms).toBeLessThan(1500);
  });

  it("D3 a socket that never finishes closing still ends, with its code, through the bounded fallback", async () => {
    const s = await startFakeCdp([page("p1", "main")], { closeReplyDelayMs: 60_000 });
    servers.push(s);
    const r = await cdp(s.port, "eval", "1");
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toBe("p1");
    expect(r.ms).toBeLessThan(8000);
  }, 15_000);
});
