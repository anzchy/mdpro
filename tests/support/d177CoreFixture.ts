/**
 * The pushCore fixture shared by the D177-WI-2 core test files: a temp hook
 * dir holding push.json and a fake token, an injected clock, pid liveness
 * probe and HTTP poster that records each request and plays back `replies`.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach } from "vitest";
import { fakeToken, makeTemp, readJsonl, readText, rmTemp } from "./d177Hooks";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { enqueue } from "../../scripts/device/hooks/pushCore.mjs";

export type Reply = { status: number; body?: string } | Error;
export interface Sent {
  url: string;
  token: string;
  body: Record<string, unknown>;
}

export const SELF_PID = 4242;
export const URL = "http://127.0.0.1:9/hook";
export const EPOCH_RE = /^[A-Za-z0-9_-]{8,64}$/;

export interface CoreFixture {
  dir: string;
  token: string;
  clock: number;
  sent: Sent[];
  replies: Reply[];
  ctx(extra?: Record<string, unknown>): Record<string, unknown>;
  enqueueMany(n: number): void;
  spool(): Record<string, unknown>[];
  dead(): Record<string, unknown>[];
  orphans(): Record<string, unknown>[];
  pushLog(): string;
  seqFile(): { epoch: string; seq: number };
  path(name: string): string;
}

export const hook = (i: number) => ({ hook_event_name: "Stop", session_id: "s", n: i });
export const seqsOf = (rows: Record<string, unknown>[]) => rows.map((r) => r.spool_seq);

export function useCore(): CoreFixture {
  const fx: CoreFixture = {
    dir: "",
    token: "",
    clock: 0,
    sent: [],
    replies: [],
    ctx: (extra = {}) => ({
      dir: fx.dir,
      fs,
      now: () => new Date(fx.clock),
      pid: SELF_PID,
      isAlive: (pid: number) => pid === SELF_PID,
      post: async (req: { url: string; token: string; body: string }) => {
        fx.sent.push({ url: req.url, token: req.token, body: JSON.parse(req.body) });
        const r = fx.replies.length > 0 ? fx.replies.shift()! : { status: 200 };
        if (r instanceof Error) throw r;
        return r;
      },
      ...extra,
    }),
    enqueueMany(n) {
      for (let i = 1; i <= n; i++) {
        fx.clock += 1000;
        enqueue(fx.ctx(), hook(i));
      }
    },
    spool: () => readJsonl(fx.path("spool.jsonl")),
    dead: () => readJsonl(fx.path("dead.jsonl")),
    orphans: () => readJsonl(fx.path("orphan.jsonl")),
    pushLog: () => readText(fx.path("push.log")),
    seqFile: () => JSON.parse(readText(fx.path("seq"))) as { epoch: string; seq: number },
    path: (name) => path.join(fx.dir, name),
  };

  beforeEach(() => {
    fx.dir = makeTemp("core");
    fx.token = fakeToken();
    fx.clock = Date.parse("2026-10-12T08:00:00.000Z");
    fx.sent = [];
    fx.replies = [];
    fs.writeFileSync(fx.path("token"), fx.token + "\n", { mode: 0o600 });
    fs.writeFileSync(fx.path("push.json"), JSON.stringify({ url: URL, source: "dtrack-mini" }));
  });

  afterEach(() => rmTemp(fx.dir));
  return fx;
}
