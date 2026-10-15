// @vitest-environment node
/**
 * D177-H-4 (audit b95 M3 and L4).
 *
 * M3: the receiver's accept log line interpolates `session`, `event` and
 * `type` only when the value is a str of at most 64 chars matching
 * [A-Za-z0-9._-]; a missing value (None) logs as `-`; any other str logs as
 * `<str>` (or `<long str>` past 64 chars), and any other type as `<type
 * name>` (`<dict>`, `<int>`, ...). Each request writes exactly one log line,
 * with no raw value and no newline injection.
 *
 * L4 (h3e): h3d's failed request, asserted this time: the reply is 500. It
 * tightens recorded test h3d (D177-H-2) without editing it, and passes on the
 * code as of 6964901.
 *
 * Boundary: a real receiver.py child on 127.0.0.1, a temp hook dir, a fake
 * token generated here.
 */
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { spooled, stopBody, useReceiver } from "../support/d177ReceiverFixture";

const fx = useReceiver();

async function newLogText(body: unknown): Promise<string> {
  const before = fx.log().length;
  expect((await fx.post(body)).status).toBe(200);
  return fx.log().slice(before);
}

const MARK = "INJECTEDLINE";

describe("D177-H4 log fields", () => {
  it.each([
    ["a dict", { a: MARK }, "session=<dict>"],
    ["a 10 kB string", MARK + "x".repeat(10_240), "session=<long str>"],
    ["a string with a newline", `ok\n2026-10-12T00:00:00+08:00 ${MARK} -> 200`, "session=<str>"],
    ["an int", 12345, "session=<int>"],
  ])("m1: session_id as %s is logged as its type, on one line", async (_n, value, expected) => {
    const text = await newLogText(stopBody({ session_id: value }));
    expect(text.split("\n").filter((l) => l !== "")).toHaveLength(1);
    expect(text).not.toContain(MARK);
    expect(text).toContain(expected);
  });

  it("m2: hook_event_name and notification_type get the same rule", async () => {
    const text = await newLogText(
      stopBody({ hook_event_name: `Stop\n${MARK}`, notification_type: { k: MARK }, session_id: "s-1" }),
    );
    expect(text.split("\n").filter((l) => l !== "")).toHaveLength(1);
    expect(text).not.toContain(MARK);
    expect(text).toContain("event=<str>");
    expect(text).toContain("type=<dict>");
    expect(text).toContain("session=s-1");
  });

  it("m3: plain values pass through and a missing one logs as -", async () => {
    const text = await newLogText(spooled(1, "dtrack-mini", { session_id: "abc-1.2_3" }));
    expect(text).toContain("event=Stop");
    expect(text).toContain("type=-");
    expect(text).toContain("session=abc-1.2_3");
  });
});

describe("D177-H4 h3e", () => {
  it("h3e: h3d's failed append is answered 500, and the receiver keeps serving", async () => {
    fs.mkdirSync(fx.file("events.jsonl"));
    let failed = -1;
    try {
      failed = (await fx.post(spooled(1))).status;
    } catch {
      failed = -1;
    }
    expect(failed).toBe(500);
    fs.rmdirSync(fx.file("events.jsonl"));
    expect((await fx.post({ hook_event_name: "Stop", session_id: "legacy" })).status).toBe(200);
    expect(fx.events()).toHaveLength(1);
  });
});

/**
 * M3, path addendum: the request path is logged only when it is at most 64
 * chars of [A-Za-z0-9._/-]; otherwise as `<long path>` (over 64 chars) or
 * `<path>`. This covers the 401 line, written before the token check, and the
 * accept line. The port comes from the receiver's own "listening on" log line.
 */
describe("D177-H4 log path", () => {
  const LONG_PATH = "/hook" + "a".repeat(80);
  const ODD_PATH = `/hook?x=${MARK}&y=%22`;

  function urlFor(p: string): string {
    const port = /listening on 127\.0\.0\.1:(\d+)/.exec(fx.log())?.[1];
    expect(port, "receiver port in its log").toBeTruthy();
    return `http://127.0.0.1:${port}${p}`;
  }

  async function logFor(p: string, token: string): Promise<{ status: number; text: string }> {
    const before = fx.log().length;
    const res = await fetch(urlFor(p), {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Mdpro-Token": token },
      body: JSON.stringify(stopBody()),
    });
    return { status: res.status, text: fx.log().slice(before) };
  }

  it.each([
    ["a long path, bad token (401 line)", LONG_PATH, false, "POST <long path> -> 401"],
    ["an odd path, bad token (401 line)", ODD_PATH, false, "POST <path> -> 401"],
    ["a long path, good token (accept line)", LONG_PATH, true, "POST <long path> -> 200"],
    ["an odd path, good token (accept line)", ODD_PATH, true, "POST <path> -> 200"],
  ])("m4: %s logs the path by kind, never raw", async (_n, p, good, expected) => {
    const { text } = await logFor(p, good ? fx.token : "not-the-token");
    expect(text.split("\n").filter((l) => l !== "")).toHaveLength(1);
    expect(text).not.toContain(MARK);
    expect(text).not.toContain("a".repeat(80));
    expect(text).toContain(expected);
  });

  it("m4: the normal /hook path still logs as /hook", async () => {
    const { status, text } = await logFor("/hook", fx.token);
    expect(status).toBe(200);
    expect(text).toContain("POST /hook -> 200");
  });
});
