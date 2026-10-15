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

/** The label probe reads Tauri's window metadata; a fake page answers it with its own label. */
const isProbe = (e: string) => e.includes("__TAURI_INTERNALS__");
const page = (id: string, label: string | null, value: unknown = id): FakePage => ({
  id,
  evaluate: (e) =>
    isProbe(e)
      ? { result: { type: "string", value: label } }
      : isUserEval(e)
        ? { result: { type: "string", value } }
        : undefined,
});
const userEvals = (s: FakeCdp, id: string) => (s.evaluated.get(id) ?? []).filter(isUserEval);

describe("cdp.mjs — WI-E2E-W item 3: a window is chosen by its label, never by list order", () => {
  it("C2 two pages and no label: exit 6, both listed, nothing evaluated", async () => {
    const s = await serve([page("p1", "main"), page("p2", "mdpro-abc")]);
    const r = await cdp(s.port, "eval", "1");
    expect(r.status, r.stderr).toBe(6);
    const out = JSON.parse(r.stdout);
    expect(out.error).toBe("WINDOW_AMBIGUOUS");
    expect(out.candidates.map((c: { label: string }) => c.label).sort()).toEqual(["main", "mdpro-abc"]);
    expect(userEvals(s, "p1")).toEqual([]);
    expect(userEvals(s, "p2")).toEqual([]);
  });

  it("C3 two pages, --window mdpro-abc: only that page runs the eval", async () => {
    const s = await serve([page("p1", "main", "one"), page("p2", "mdpro-abc", "two")]);
    const r = await cdp(s.port, "--window", "mdpro-abc", "eval", "1");
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout)).toBe("two");
    expect(userEvals(s, "p1")).toEqual([]);
    expect(userEvals(s, "p2")).toHaveLength(1);
  });

  it("C3b MDPRO_CDP_LABEL selects the same way, even when the window is not listed first", async () => {
    const s = await serve([page("p1", "mdpro-abc", "two"), page("p2", "main", "one")]);
    const p = await new Promise<{ status: number | null; stdout: string }>((resolve) => {
      const c = spawn(process.execPath, [CDP, "eval", "1"], {
        env: { ...process.env, MDPRO_CDP_PORT: String(s.port), MDPRO_CDP_LABEL: "main" },
      });
      let stdout = "";
      c.stdout.on("data", (d) => (stdout += d));
      c.on("close", (status) => resolve({ status, stdout }));
    });
    expect(p.status).toBe(0);
    expect(JSON.parse(p.stdout)).toBe("one");
  });

  it("C4a a label no page has: exit 5, candidates listed, nothing evaluated", async () => {
    const s = await serve([page("p1", "main"), page("p2", "mdpro-abc")]);
    const r = await cdp(s.port, "--window", "mdpro-zzz", "eval", "1");
    expect(r.status).toBe(5);
    const out = JSON.parse(r.stdout);
    expect(out.error).toBe("WINDOW_NOT_FOUND");
    expect(out.candidates).toHaveLength(2);
    expect(userEvals(s, "p1")).toEqual([]);
    expect(userEvals(s, "p2")).toEqual([]);
  });

  it("C4b a label two pages report: exit 6, nothing evaluated", async () => {
    const s = await serve([page("p1", "main"), page("p2", "main")]);
    const r = await cdp(s.port, "--window", "main", "eval", "1");
    expect(r.status).toBe(6);
    expect(userEvals(s, "p1")).toEqual([]);
    expect(userEvals(s, "p2")).toEqual([]);
  });

  it("C6 the label is checked again on the eval's own connection: a changed answer exits 5 before the eval", async () => {
    let probes = 0;
    const s = await serve([
      {
        id: "p1",
        evaluate: (e) => {
          if (isProbe(e)) return { result: { type: "string", value: (probes += 1) === 1 ? "main" : "other" } };
          return isUserEval(e) ? { result: { type: "number", value: 1 } } : undefined;
        },
      },
    ]);
    const r = await cdp(s.port, "--window", "main", "eval", "1");
    expect(r.status).toBe(5);
    expect(JSON.parse(r.stdout).error).toBe("WINDOW_MISMATCH");
    expect(userEvals(s, "p1")).toEqual([]);
  });

  it("C7 one page and no label still evaluates there (single-window runs are unchanged)", async () => {
    const s = await serve([page("p1", "main", "only")]);
    const r = await cdp(s.port, "eval", "1");
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout)).toBe("only");
  });
});
