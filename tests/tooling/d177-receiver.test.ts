// @vitest-environment node
/**
 * D177-WI-1: the MacBook hook receiver dedupes spooled events and tracks gaps.
 *
 * A body with no spool_* field is the legacy http-hook payload and is stored
 * exactly as before. A body with spool_* fields must carry a valid
 * `spool_source` / `spool_epoch` / `spool_seq` / `spool_ts` / `spool_dead`; a
 * repeat of (source, epoch, seq) is answered 200 and dropped; missing seqs of
 * the current epoch are written to gaps.json as
 * `{ "<source>": { epoch, max, missing, dead } }`; the seq state survives a
 * restart (seq-state.json) and a corrupt one does not stop the receiver.
 * Epoch switches and spool_dead live in d177-receiver-epoch.test.ts.
 *
 * Boundary: a real receiver.py child on 127.0.0.1, a temp hook dir, a fake
 * token generated here.
 */
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { fakeToken, readText } from "../support/d177Hooks";
import { EPOCH_A, spoolWithout, spooled, stopBody, useReceiver } from "../support/d177ReceiverFixture";

const LEGACY_KEYS = [
  "received_at",
  "remote",
  "hook_event_name",
  "session_id",
  "cwd",
  "notification_type",
  "title",
  "message",
  "last_assistant_message",
  "stop_hook_active",
  "matcher",
  "source",
].sort();
const SPOOL_KEYS = ["spool_source", "spool_epoch", "spool_seq", "spool_ts", "spool_dead"];

const fx = useReceiver();
const gapOf = (max: number, missing: number[], dead = 0) => ({ epoch: EPOCH_A, max, missing, dead });

describe("D177-WI-1 receiver", () => {
  it("r1: a legacy payload (no spool_*) is stored with exactly today's keys and mirrored to latest.json", async () => {
    const res = await fx.post(stopBody({ unrelated: "x" }));
    expect(res.status).toBe(200);
    const recs = fx.events();
    expect(recs).toHaveLength(1);
    expect(Object.keys(recs[0]).sort()).toEqual(LEGACY_KEYS);
    expect(recs[0].hook_event_name).toBe("Stop");
    expect(JSON.parse(readText(fx.file("latest.json")))).toEqual(recs[0]);
  });

  it("r2: a spooled payload adds the five spool_* keys and keeps SessionStart's own source", async () => {
    const res = await fx.post({
      hook_event_name: "SessionStart",
      session_id: "s-2",
      source: "clear",
      spool_source: "dtrack-mini",
      spool_epoch: EPOCH_A,
      spool_seq: 1,
      spool_ts: "2026-10-12T08:01:02.345Z",
      spool_dead: 0,
    });
    expect(res.status).toBe(200);
    const [rec] = fx.events();
    expect(rec.source).toBe("clear");
    expect(rec.spool_source).toBe("dtrack-mini");
    expect(rec.spool_epoch).toBe(EPOCH_A);
    expect(rec.spool_seq).toBe(1);
    expect(rec.spool_ts).toBe("2026-10-12T08:01:02.345Z");
    expect(rec.spool_dead).toBe(0);
    expect(typeof rec.received_at).toBe("string");
    expect(Object.keys(rec).sort()).toEqual([...LEGACY_KEYS, ...SPOOL_KEYS].sort());
  });

  it("r3: a duplicate (same source, epoch and seq) is answered 200 and not appended; latest.json is unchanged", async () => {
    await fx.sendSeqs("dtrack-mini", [1]);
    const latestBefore = readText(fx.file("latest.json"));
    const res = await fx.post(spooled(1, "dtrack-mini", { last_assistant_message: "second copy" }));
    expect(res.status).toBe(200);
    expect(fx.events()).toHaveLength(1);
    expect(readText(fx.file("latest.json"))).toBe(latestBefore);
  });

  it("r4: gaps.json lists missing seqs per source, shrinks on a late arrival, sources independent", async () => {
    await fx.sendSeqs("dtrack-mini", [1, 2, 5]);
    await fx.sendSeqs("other.src", [1, 3]);
    expect(fx.gaps()).toEqual({ "dtrack-mini": gapOf(5, [3, 4]), "other.src": gapOf(3, [2]) });
    await fx.sendSeqs("dtrack-mini", [3]);
    expect(fx.gaps()).toEqual({ "dtrack-mini": gapOf(5, [4]), "other.src": gapOf(3, [2]) });
    expect(fx.events()).toHaveLength(6);
  });

  it("r5: seq state persists across a restart (dedupe and gaps)", async () => {
    await fx.sendSeqs("dtrack-mini", [1, 2, 5]);
    await fx.restart();
    expect((await fx.post(spooled(2))).status).toBe(200);
    expect(fx.events()).toHaveLength(3);
    await fx.sendSeqs("dtrack-mini", [6]);
    expect(fx.events()).toHaveLength(4);
    expect(fx.gaps()?.["dtrack-mini"]).toEqual(gapOf(6, [3, 4]));
  });

  const invalid: [string, Record<string, unknown>][] = [
    ["seq 0", spooled(0)],
    ["seq negative", spooled(-1)],
    ["seq non-integer", spooled(1.5)],
    ["seq string", spooled("3")],
    ["seq bool", spooled(true)],
    ["seq missing", spoolWithout("spool_seq")],
    ["source missing", spoolWithout("spool_source")],
    ["source empty", spooled(1, "")],
    ["source with a space", spooled(1, "dtrack mini")],
    ["source with a slash", spooled(1, "a/b")],
    ["source 65 chars", spooled(1, "a".repeat(65))],
    ["source not a string", spooled(1, 7)],
    ["ts missing", spoolWithout("spool_ts")],
    ["ts not a string", spooled(1, "dtrack-mini", { spool_ts: 12345 })],
    ["epoch missing", spoolWithout("spool_epoch")],
    ["epoch 7 chars", spooled(1, "dtrack-mini", { spool_epoch: "abcd123" })],
    ["epoch 65 chars", spooled(1, "dtrack-mini", { spool_epoch: "e".repeat(65) })],
    ["epoch with a dot", spooled(1, "dtrack-mini", { spool_epoch: "epoch.with.dot" })],
    ["epoch not a string", spooled(1, "dtrack-mini", { spool_epoch: 12345678 })],
    ["dead missing", spoolWithout("spool_dead")],
    ["dead negative", spooled(1, "dtrack-mini", { spool_dead: -1 })],
    ["dead non-integer", spooled(1, "dtrack-mini", { spool_dead: 0.5 })],
    ["dead string", spooled(1, "dtrack-mini", { spool_dead: "2" })],
    ["dead bool", spooled(1, "dtrack-mini", { spool_dead: false })],
  ];

  it.each(invalid)("r6: invalid spool fields (%s) → 400, nothing appended", async (_name, body) => {
    const res = await fx.post(body);
    expect(res.status).toBe(400);
    expect(fx.events()).toHaveLength(0);
    expect(fs.existsSync(fx.file("latest.json"))).toBe(false);
  });

  it("r7a: bad or missing token → 401 for legacy and spooled; no token value in log or body", async () => {
    const wrong = fakeToken();
    const bodies: string[] = [];
    for (const body of [stopBody(), spooled(1)]) {
      for (const tok of [wrong, null]) {
        const res = await fx.post(body, tok);
        expect(res.status).toBe(401);
        bodies.push(await res.text());
      }
    }
    expect(fx.events()).toHaveLength(0);
    const log = fx.log();
    expect(log).toContain("401");
    for (const text of [log, ...bodies]) {
      expect(text.includes(fx.token)).toBe(false);
      expect(text.includes(wrong)).toBe(false);
    }
  });

  it("r7b: a spooled 401 does not touch the seq state", async () => {
    expect((await fx.post(spooled(1), fakeToken())).status).toBe(401);
    expect((await fx.post(spooled(9, "dtrack-mini", { spool_dead: 7 }), fakeToken())).status).toBe(401);
    await fx.sendSeqs("dtrack-mini", [1, 2]);
    expect(fx.events()).toHaveLength(2);
    expect(fx.gaps()).toEqual({ "dtrack-mini": gapOf(2, []) });
  });

  it("r8: a corrupt seq-state.json is logged, treated as empty, and does not stop the receiver", async () => {
    await fx.restart(() => fs.writeFileSync(fx.file("seq-state.json"), "{not json at all"));
    await fx.sendSeqs("dtrack-mini", [1]);
    expect(fx.events()).toHaveLength(1);
    expect(fx.log()).toMatch(/seq-state/);
    expect(() => JSON.parse(readText(fx.file("seq-state.json")))).not.toThrow();
    expect(fx.gaps()).toEqual({ "dtrack-mini": gapOf(1, []) });
  });
});
