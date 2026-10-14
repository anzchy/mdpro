// @vitest-environment node
/**
 * D177-WI-2: push.mjs as the dtrack hook command, spawned for real.
 *
 * s1 the hook never waits on the network; s2 events survive an outage and
 * are replayed once each, in order, with their original spool_ts and one
 * epoch, also when a slow receiver makes the hook-spawned flushers skip
 * (D196), and two concurrent flushers do not double-send; s3 malformed stdin
 * is logged and still exits 0; s4 a seq lock held by a live process sends
 * the event to orphan.jsonl and the hook still returns within 1 s.
 *
 * Boundaries: a temp HOME and MDPRO_HOOK_DIR, an in-test HTTP server (or a
 * socket that never answers) on 127.0.0.1, a fake token.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PUSH, drainSpool, fakeToken, freePort, makeTemp, readJsonl, readText, rmTemp, waitFor } from "./support/d177Hooks";

let home: string;
let dir: string;
let token: string;
const closers: (() => Promise<void>)[] = [];

function runPush(args: string[], stdin: string): Promise<{ code: number | null; ms: number }> {
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [PUSH, ...args], {
      env: { ...process.env, HOME: home, MDPRO_HOOK_DIR: dir },
      stdio: ["pipe", "ignore", "ignore"],
    });
    const kill = setTimeout(() => child.kill("SIGKILL"), 10_000);
    child.once("error", reject);
    child.once("exit", (code) => {
      clearTimeout(kill);
      resolve({ code, ms: Date.now() - t0 });
    });
    child.stdin!.end(stdin);
  });
}

function writeConfig(port: number) {
  fs.writeFileSync(path.join(dir, "push.json"), JSON.stringify({ url: `http://127.0.0.1:${port}/hook`, source: "dtrack-mini" }));
}

const spool = () => readJsonl(path.join(dir, "spool.jsonl"));
const flushIdle = () => waitFor(() => !fs.existsSync(path.join(dir, "flush.lock")), 8000);
const hookJson = (i: number) => JSON.stringify({ hook_event_name: "Stop", session_id: "s", n: i });

interface Hit {
  status: number;
  seq: number;
  ts: string;
  epoch: string;
  dead: unknown;
  token: string | undefined;
}

/** Answers 503 to the first `failFirst` requests, each held `failDelayMs` before it is answered. */
async function recordingServer(failFirst: number, failDelayMs = 0): Promise<{ port: number; hits: Hit[] }> {
  const hits: Hit[] = [];
  let failures = 0;
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = JSON.parse(raw) as { spool_seq: number; spool_ts: string; spool_epoch: string; spool_dead: unknown };
      const status = failures < failFirst ? 503 : 200;
      if (status === 503) failures++;
      hits.push({ status, seq: body.spool_seq, ts: body.spool_ts, epoch: body.spool_epoch, dead: body.spool_dead, token: req.headers["x-mdpro-token"] as string | undefined });
      if (status === 503 && failDelayMs > 0) setTimeout(() => res.writeHead(status).end("{}"), failDelayMs);
      else res.writeHead(status).end("{}");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  closers.push(() => new Promise<void>((r) => server.close(() => r())));
  return { port: (server.address() as { port: number }).port, hits };
}

beforeEach(() => {
  home = makeTemp("push-home");
  dir = path.join(home, "hookdir");
  fs.mkdirSync(dir);
  token = fakeToken();
  fs.writeFileSync(path.join(dir, "token"), token + "\n", { mode: 0o600 });
});

afterEach(async () => {
  await flushIdle();
  while (closers.length) await closers.pop()!();
  rmTemp(home);
});

describe("D177-WI-2 push.mjs", () => {
  it("s1: with a receiver that never answers, the hook exits 0 in under 1 s and the event is spooled", async () => {
    const sockets: net.Socket[] = [];
    const sink = net.createServer((s) => sockets.push(s));
    await new Promise<void>((r) => sink.listen(0, "127.0.0.1", () => r()));
    closers.push(
      () =>
        new Promise<void>((r) => {
          sockets.forEach((s) => s.destroy());
          sink.close(() => r());
        }),
    );
    writeConfig((sink.address() as { port: number }).port);
    const { code, ms } = await runPush([], hookJson(1));
    expect(code).toBe(0);
    expect(ms).toBeLessThan(1000);
    expect(spool().map((e) => [e.spool_source, e.spool_seq, e.n])).toEqual([["dtrack-mini", 1, 1]]);
  }, 15_000);

  it.each([
    ["an outage", 0],
    // D196: each 503 is held long enough that the flushers spawned by hooks 2-5
    // find flush.lock taken and skip, the interleaving a slow CI runner hits.
    ["an outage behind a slow receiver", 1500],
  ])("s2: after %s every seq arrives exactly once, in order, with its original spool_ts", async (_n, failDelayMs) => {
    const N = 5;
    const { port, hits } = await recordingServer(3, failDelayMs);
    writeConfig(port);
    const windows: [number, number][] = [];
    for (let i = 1; i <= N; i++) {
      const before = Date.now();
      expect((await runPush([], hookJson(i))).code).toBe(0);
      windows.push([before, Date.now()]);
    }
    // The hooks' own detached flushers must reach the receiver before any
    // explicit flush runs; waited for, since a one-shot check would race them.
    expect(await waitFor(() => hits.length > 0, 8000), "a hook-spawned flusher POSTed").toBe(true);
    await drainSpool({
      flushIdle,
      flushOnce: async () => expect((await runPush(["--flush"], "")).code).toBe(0),
      spoolEmpty: () => spool().length === 0,
    });
    await flushIdle();
    const ok = hits.filter((h) => h.status === 200);
    expect(ok.map((h) => h.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(hits.some((h) => h.status === 503)).toBe(true);
    expect(hits.every((h) => h.token === token)).toBe(true);
    expect(hits[0].epoch).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(hits.every((h) => h.epoch === hits[0].epoch && h.dead === 0)).toBe(true);
    for (const h of hits) {
      const [before, after] = windows[h.seq - 1];
      const t = Date.parse(h.ts);
      expect(t).toBeGreaterThanOrEqual(before - 1000);
      expect(t).toBeLessThanOrEqual(after);
      expect(h.ts).toBe(ok[h.seq - 1].ts);
    }
  }, 30_000);

  it("s2: two concurrent --flush runs deliver each seq once", async () => {
    writeConfig(await freePort());
    for (let i = 1; i <= 6; i++) expect((await runPush([], hookJson(i))).code).toBe(0);
    await flushIdle();
    expect(spool()).toHaveLength(6);
    const { port, hits } = await recordingServer(0);
    writeConfig(port);
    const runs = await Promise.all([runPush(["--flush"], ""), runPush(["--flush"], "")]);
    expect(runs.map((r) => r.code)).toEqual([0, 0]);
    await waitFor(() => spool().length === 0, 8000);
    await flushIdle();
    expect(hits.map((h) => h.seq)).toEqual([1, 2, 3, 4, 5, 6]);
  }, 15_000);

  it.each([
    ["not json", "{this is not json"],
    ["a JSON array", "[1,2]"],
    ["empty stdin", ""],
  ])("s3: malformed stdin (%s) exits 0, is logged, and spools nothing", async (_n, stdin) => {
    writeConfig(await freePort());
    const { code } = await runPush([], stdin);
    expect(code).toBe(0);
    expect(spool()).toEqual([]);
    expect(readText(path.join(dir, "push.log"))).toMatch(/stdin/i);
    expect(fs.existsSync(path.join(dir, "seq"))).toBe(false);
  }, 15_000);

  it("s4: a seq lock held by a live process orphans the event; the hook exits 0 within 1 s", async () => {
    writeConfig(await freePort());
    const lock = path.join(dir, "seq.lock");
    fs.mkdirSync(lock);
    fs.writeFileSync(path.join(lock, "owner"), String(process.pid));
    const { code, ms } = await runPush([], hookJson(7));
    expect(code).toBe(0);
    expect(ms).toBeLessThan(1000);
    const orphans = readJsonl(path.join(dir, "orphan.jsonl"));
    expect(orphans).toHaveLength(1);
    expect(orphans[0]).toMatchObject({ hook_event_name: "Stop", n: 7 });
    expect(orphans[0]).not.toHaveProperty("spool_seq");
    // Checked first so a failure reads as an assertion, not an ENOENT the receipt CLI misreads.
    expect(fs.existsSync(path.join(dir, "orphan.jsonl")), "path.join(dir, 'orphan.jsonl') exists").toBe(true);
    expect(fs.statSync(path.join(dir, "orphan.jsonl")).mode & 0o777).toBe(0o600);
    expect(spool()).toEqual([]);
    expect(readText(path.join(dir, "push.log"))).toMatch(/seq lock busy/);
    // Checked first so a failure reads as an assertion, not an ENOENT the receipt CLI misreads.
    expect(fs.existsSync(path.join(lock, "owner")), "path.join(lock, 'owner') exists").toBe(true);
    expect(fs.readFileSync(path.join(lock, "owner"), "utf8")).toBe(String(process.pid));
  }, 15_000);
});
