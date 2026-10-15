// @vitest-environment node
/**
 * D177-WI-2: pushCore numbers, spools and replays dtrack hook events.
 *
 * Partition: seq numbering (fresh, across invocations, stale lock) × flush
 * order × response class (2xx drop / 401·408·429·5xx·network stop / other
 * 4xx dead-and-continue) × spool cap × secret hygiene of every output.
 * Epochs, spool_dead and the busy seq lock live in
 * d177-push-core-epoch.test.ts.
 *
 * Boundaries: fs is real but confined to a temp dir; the clock, the pid
 * liveness probe and the HTTP poster are injected. One p6 case uses the real
 * default poster against a local server that echoes the request headers.
 */
import fs from "node:fs";
import http from "node:http";
import { describe, expect, it } from "vitest";
import { readText } from "../support/d177Hooks";
import { EPOCH_RE, SELF_PID, URL, hook, seqsOf, useCore, type Reply } from "../support/d177CoreFixture";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { SPOOL_CAP, enqueue, flush, nextSeq } from "../../scripts/device/hooks/pushCore.mjs";

const fx = useCore();

describe("D177-WI-2 pushCore", () => {
  it("p1: seq starts at 1 and is monotonic across separate invocations, under one epoch", () => {
    const a = nextSeq(fx.ctx());
    expect(a.seq).toBe(1);
    expect(a.epoch).toMatch(EPOCH_RE);
    expect(nextSeq(fx.ctx())).toEqual({ epoch: a.epoch, seq: 2 });
    expect(nextSeq(fx.ctx({ pid: 777, isAlive: (p: number) => p === 777 }))).toEqual({ epoch: a.epoch, seq: 3 });
    expect(fx.seqFile()).toEqual({ epoch: a.epoch, seq: 3 });
    const r = enqueue(fx.ctx(), hook(1));
    expect(r.seq).toBe(4);
    expect(fx.spool()).toEqual([
      { spool_source: "dtrack-mini", spool_epoch: a.epoch, spool_seq: 4, spool_ts: new Date(fx.clock).toISOString(), ...hook(1) },
    ]);
    // Checked first so a failure reads as an assertion, not an ENOENT the receipt CLI misreads.
    expect(fs.existsSync(fx.path("spool.jsonl")), "fx.path('spool.jsonl') exists").toBe(true);
    expect(fs.statSync(fx.path("spool.jsonl")).mode & 0o777).toBe(0o600);
  });

  it("p1b: a seq lock left by a dead owner is reclaimed; the lock is released after use", () => {
    fs.mkdirSync(fx.path("seq.lock"));
    fs.writeFileSync(fx.path("seq.lock/owner"), "99999");
    expect(nextSeq(fx.ctx()).seq).toBe(1);
    expect(fs.existsSync(fx.path("seq.lock"))).toBe(false);
  });

  it("p2: flush sends in ascending seq order with the token header value and the original spool_ts", async () => {
    fx.enqueueMany(4);
    const tsBySeq = new Map(fx.spool().map((e) => [e.spool_seq, e.spool_ts]));
    fx.clock += 60_000;
    const res = await flush(fx.ctx());
    expect(res.skipped).toBe(false);
    expect(fx.sent.map((s) => s.body.spool_seq)).toEqual([1, 2, 3, 4]);
    expect(fx.sent.every((s) => s.url === URL && s.token === fx.token)).toBe(true);
    expect(fx.sent.every((s) => s.body.spool_ts === tsBySeq.get(s.body.spool_seq))).toBe(true);
    expect(res.sent).toEqual([1, 2, 3, 4]);
    expect(fx.spool()).toEqual([]);
  });

  it("p2b: a flush lock held by a live owner skips; a dead owner's lock is reclaimed", async () => {
    fx.enqueueMany(1);
    fs.mkdirSync(fx.path("flush.lock"));
    fs.writeFileSync(fx.path("flush.lock/owner"), "555");
    const held = await flush(fx.ctx({ isAlive: (p: number) => p === SELF_PID || p === 555 }));
    expect(held.skipped).toBe(true);
    expect(fx.sent).toHaveLength(0);
    const reclaimed = await flush(fx.ctx());
    expect(reclaimed.skipped).toBe(false);
    expect(fx.sent.map((s) => s.body.spool_seq)).toEqual([1]);
  });

  it("p3: only a 2xx removes an entry", async () => {
    fx.enqueueMany(3);
    fx.replies.push({ status: 200 }, { status: 204 }, { status: 503 });
    const res = await flush(fx.ctx());
    expect(seqsOf(fx.spool())).toEqual([3]);
    expect(res.sent).toEqual([1, 2]);
    expect(res.stopped).toEqual({ seq: 3, reason: "status", status: 503 });
  });

  it("p4: any other 4xx moves the entry to dead.jsonl with its status and the flush continues", async () => {
    fx.enqueueMany(3);
    fx.replies.push({ status: 400 }, { status: 404 }, { status: 200 });
    const res = await flush(fx.ctx());
    expect(fx.spool()).toEqual([]);
    expect(res.dead).toEqual([1, 2]);
    expect(fx.dead().map((d) => [d.reason, d.status, (d.entry as Record<string, unknown>).spool_seq])).toEqual([
      ["status", 400, 1],
      ["status", 404, 2],
    ]);
  });

  const stoppers: [string, Reply, Record<string, unknown>][] = [
    ["401", { status: 401 }, { reason: "status", status: 401 }],
    ["408", { status: 408 }, { reason: "status", status: 408 }],
    ["429", { status: 429 }, { reason: "status", status: 429 }],
    ["500", { status: 500 }, { reason: "status", status: 500 }],
    ["503", { status: 503 }, { reason: "status", status: 503 }],
    ["network error", new TypeError("fetch failed"), { reason: "network" }],
  ];

  it.each(stoppers)("p4: %s stops the flush and keeps that entry and everything after", async (_n, reply, stopped) => {
    fx.enqueueMany(3);
    fx.replies.push({ status: 200 }, reply);
    const res = await flush(fx.ctx());
    expect(fx.sent.map((s) => s.body.spool_seq)).toEqual([1, 2]);
    expect(seqsOf(fx.spool())).toEqual([2, 3]);
    expect(fx.dead()).toEqual([]);
    expect(res.stopped).toEqual({ seq: 2, ...stopped });
  });

  it("p5: past the cap of 5000 the oldest entry goes to dead.jsonl with reason cap, and is counted", async () => {
    expect(SPOOL_CAP).toBe(5000);
    const epoch = "capEpoch0001";
    const lines: string[] = [];
    for (let s = 1; s <= SPOOL_CAP; s++) {
      lines.push(JSON.stringify({ spool_source: "dtrack-mini", spool_epoch: epoch, spool_seq: s, spool_ts: "t", n: s }));
    }
    fs.writeFileSync(fx.path("spool.jsonl"), lines.join("\n") + "\n", { mode: 0o600 });
    fs.writeFileSync(fx.path("seq"), JSON.stringify({ epoch, seq: SPOOL_CAP }));
    const a = enqueue(fx.ctx(), hook(1));
    const b = enqueue(fx.ctx(), hook(2));
    expect([a.seq, b.seq]).toEqual([5001, 5002]);
    expect([a.dropped, b.dropped]).toEqual([1, 1]);
    const rows = fx.spool();
    expect(rows).toHaveLength(SPOOL_CAP);
    expect(rows[0].spool_seq).toBe(3);
    expect(rows[rows.length - 1].spool_seq).toBe(5002);
    expect(fx.dead().map((d) => [d.reason, (d.entry as Record<string, unknown>).spool_seq])).toEqual([
      ["cap", 1],
      ["cap", 2],
    ]);
    expect(fx.pushLog()).toMatch(/cap/);
    fx.replies.push({ status: 503 });
    await flush(fx.ctx());
    expect([fx.sent[0].body.spool_seq, fx.sent[0].body.spool_dead]).toEqual([3, 2]);
  });

  const BODY_MARK = "RESPONSE-BODY-MARKER-d177";
  const leaky: [string, (t: string) => Reply][] = [
    ["network error naming the token", (t) => new Error(`connect failed X-Mdpro-Token: ${t} ${BODY_MARK}`)],
    ["500 with a body", (t) => ({ status: 500, body: `${BODY_MARK} x-mdpro-token=${t}` })],
    ["401 with a body", (t) => ({ status: 401, body: `${BODY_MARK} ${t}` })],
    ["404 echoing headers", (t) => ({ status: 404, body: `{"x-mdpro-token":"${t}","m":"${BODY_MARK}"}` })],
  ];

  it.each(leaky)("p6: %s — no log line, result or thrown message carries the token or body", async (_n, reply) => {
    fx.enqueueMany(1);
    fx.replies.push(reply(fx.token));
    let out = "";
    try {
      out = JSON.stringify(await flush(fx.ctx()));
    } catch (e) {
      out = e instanceof Error ? `${e.message}\n${e.stack}` : String(e);
    }
    expect(fx.pushLog()).not.toBe("");
    for (const t of [out, fx.pushLog(), readText(fx.path("dead.jsonl"))]) {
      expect(t.includes(fx.token)).toBe(false);
      expect(t.includes(BODY_MARK)).toBe(false);
    }
  });

  it("p6: the default poster against a server echoing request headers leaks nothing", async () => {
    const server = http.createServer((req, res) => {
      req.resume();
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ echoed: req.headers, m: BODY_MARK }));
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    try {
      const port = (server.address() as { port: number }).port;
      fs.writeFileSync(fx.path("push.json"), JSON.stringify({ url: `http://127.0.0.1:${port}/hook`, source: "dtrack-mini" }));
      fx.enqueueMany(1);
      const c = fx.ctx();
      delete c.post;
      const out = JSON.stringify(await flush(c));
      expect(fx.dead()).toHaveLength(1);
      for (const t of [out, fx.pushLog(), readText(fx.path("dead.jsonl"))]) {
        expect(t.includes(fx.token)).toBe(false);
        expect(t.includes(BODY_MARK)).toBe(false);
      }
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});
