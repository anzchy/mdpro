/**
 * The receiver.py fixture shared by the D177-WI-1 test files: a temp HOME and
 * hook dir with a fake token, a receiver child started before each test and
 * stopped after it, and body builders for legacy and spooled payloads.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach } from "vitest";
import { fakeToken, makeTemp, readJsonl, readText, rmTemp, startReceiver, stopReceiver, type Receiver } from "./d177Hooks";

export const EPOCH_A = "epochAAAA1111";
export const EPOCH_B = "epochBBBB2222";
export const TS = "2026-10-12T08:00:00.000Z";

export const stopBody = (extra: Record<string, unknown> = {}) => ({
  hook_event_name: "Stop",
  session_id: "s-1",
  cwd: "/tmp/x",
  stop_hook_active: false,
  last_assistant_message: "done",
  ...extra,
});

/** A valid spooled Stop body: epoch A, spool_dead 0, unless `extra` overrides. */
export const spooled = (seq: unknown, source: unknown = "dtrack-mini", extra: Record<string, unknown> = {}) =>
  stopBody({ spool_source: source, spool_epoch: EPOCH_A, spool_seq: seq, spool_ts: TS, spool_dead: 0, ...extra });

/** The four valid spool fields minus `omit`. */
export function spoolWithout(omit: string): Record<string, unknown> {
  const body: Record<string, unknown> = spooled(1);
  delete body[omit];
  return body;
}

export interface ReceiverFixture {
  readonly dir: string;
  readonly token: string;
  post(body: unknown, tok?: string | null): Promise<Response>;
  sendSeqs(source: string, seqs: number[], extra?: Record<string, unknown>): Promise<void>;
  events(): Record<string, unknown>[];
  gaps(): Record<string, Record<string, unknown>> | null;
  log(): string;
  file(name: string): string;
  restart(beforeStart?: () => void): Promise<void>;
}

export function useReceiver(): ReceiverFixture {
  let home = "";
  let dir = "";
  let token = "";
  let rx: Receiver | undefined;

  beforeEach(async () => {
    home = makeTemp("rx-home");
    dir = path.join(home, "hookdir");
    fs.mkdirSync(dir);
    token = fakeToken();
    fs.writeFileSync(path.join(dir, "token"), token + "\n", { mode: 0o600 });
    rx = await startReceiver(dir, home);
  });

  afterEach(async () => {
    await stopReceiver(rx);
    rx = undefined;
    rmTemp(home);
  });

  const fx: ReceiverFixture = {
    get dir() {
      return dir;
    },
    get token() {
      return token;
    },
    post(body, tok = token) {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (tok !== null) headers["X-Mdpro-Token"] = tok;
      return fetch(rx!.url, { method: "POST", headers, body: JSON.stringify(body) });
    },
    async sendSeqs(source, seqs, extra = {}) {
      for (const s of seqs) {
        const res = await fx.post(spooled(s, source, extra));
        if (res.status !== 200) throw new Error(`seq ${s} of ${source} got ${res.status}`);
      }
    },
    events: () => readJsonl(path.join(dir, "events.jsonl")),
    gaps: () => JSON.parse(readText(path.join(dir, "gaps.json")) || "null"),
    log: () => readText(path.join(dir, "receiver.log")),
    file: (name) => path.join(dir, name),
    async restart(beforeStart) {
      await stopReceiver(rx);
      beforeStart?.();
      rx = await startReceiver(dir, home);
    },
  };
  return fx;
}
