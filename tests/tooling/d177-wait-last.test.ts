// @vitest-environment node
/**
 * D177-WI-3: last-dtrack.sh and wait-dtrack.sh report the receiver's gaps.
 *
 * gaps.json `{ "<source>": { epoch, max, missing, dead } }` is printed as ranges
 * (`missing seq 3..4 (dtrack-mini)`, `missing seq 7 (dtrack-mini)`) and
 * `dead N (source)` when dead > 0; nothing extra without gaps. The epoch is
 * not printed, and its presence does not change the lines. last prints
 * them on stdout after latest.json; wait prints them on stderr, on a match
 * (exit 0) and on a timeout (exit 124). Both honour MDPRO_HOOK_DIR.
 *
 * Boundaries: a temp HOME (so a script that ignores MDPRO_HOOK_DIR reads an
 * empty dir, never the real one) and a separate temp hook dir.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LAST, WAIT, makeTemp, rmTemp } from "../support/d177Hooks";

let home: string;
let dir: string;

interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
}

function run(script: string, args: string[], onStart?: () => void): Promise<Run> {
  return new Promise((resolve, reject) => {
    const child = spawn("bash", [script, ...args], {
      env: { ...process.env, HOME: home, MDPRO_HOOK_DIR: dir },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout!.on("data", (c) => (stdout += c));
    child.stderr!.on("data", (c) => (stderr += c));
    const kill = setTimeout(() => child.kill("SIGKILL"), 10_000);
    child.once("error", reject);
    child.once("exit", (code) => {
      clearTimeout(kill);
      resolve({ code, stdout, stderr });
    });
    onStart?.();
  });
}

const LATEST = { received_at: "2026-10-12T08:00:00+08:00", hook_event_name: "Stop", session_id: "s-9" };
const GAPS = {
  "dtrack-mini": { epoch: "epochAAAA1111", max: 9, missing: [3, 4, 7], dead: 2 },
  "other.src": { epoch: "epochBBBB2222", max: 4, missing: [], dead: 0 },
};
const GAP_LINES = ["missing seq 3..4 (dtrack-mini)", "missing seq 7 (dtrack-mini)", "dead 2 (dtrack-mini)"];

const gapLinesIn = (text: string) => text.split("\n").filter((l) => /^(missing seq|dead) /.test(l));

beforeEach(() => {
  home = makeTemp("wl-home");
  dir = makeTemp("wl-dir");
  fs.writeFileSync(path.join(dir, "latest.json"), JSON.stringify(LATEST) + "\n");
});

afterEach(() => {
  rmTemp(home);
  rmTemp(dir);
});

describe("D177-WI-3 last-dtrack.sh", () => {
  it("prints latest.json, then the gap ranges and dead count per source", async () => {
    fs.writeFileSync(path.join(dir, "gaps.json"), JSON.stringify(GAPS));
    const r = await run(LAST, []);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('"session_id": "s-9"');
    expect(gapLinesIn(r.stdout)).toEqual(GAP_LINES);
  });

  it("prints a long run as one range and a dead-only source as one line", async () => {
    fs.writeFileSync(
      path.join(dir, "gaps.json"),
      JSON.stringify({
        a: { epoch: "epochAAAA1111", max: 20, missing: [2, 3, 4, 5, 10, 12, 13], dead: 0 },
        b: { epoch: "epochBBBB2222", max: 3, missing: [], dead: 4 },
      }),
    );
    const r = await run(LAST, []);
    expect(gapLinesIn(r.stdout)).toEqual([
      "missing seq 2..5 (a)",
      "missing seq 10 (a)",
      "missing seq 12..13 (a)",
      "dead 4 (b)",
    ]);
  });

  it.each([
    ["absent", null],
    ["empty object", "{}"],
    ["no gaps", JSON.stringify({ "dtrack-mini": { epoch: "epochAAAA1111", max: 3, missing: [], dead: 0 } })],
  ])("prints no gap lines when gaps.json is %s", async (_n, content) => {
    if (content !== null) fs.writeFileSync(path.join(dir, "gaps.json"), content);
    const r = await run(LAST, []);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('"session_id": "s-9"');
    expect(gapLinesIn(r.stdout + r.stderr)).toEqual([]);
  });
});

describe("D177-WI-3 wait-dtrack.sh", () => {
  it("on timeout exits 124 and prints the gap lines on stderr", async () => {
    fs.writeFileSync(path.join(dir, "gaps.json"), JSON.stringify(GAPS));
    const r = await run(WAIT, ["-t", "1"]);
    expect(r.code).toBe(124);
    expect(r.stdout).toBe("");
    expect(gapLinesIn(r.stderr)).toEqual(GAP_LINES);
  }, 15_000);

  it("on a match prints the event on stdout, exits 0, and prints the gap lines on stderr", async () => {
    fs.writeFileSync(path.join(dir, "gaps.json"), JSON.stringify(GAPS));
    const events = path.join(dir, "events.jsonl");
    fs.writeFileSync(events, JSON.stringify({ hook_event_name: "SessionStart" }) + "\n");
    const line = JSON.stringify({ hook_event_name: "Notification", notification_type: "idle_prompt", session_id: "s-10" });
    const r = await run(WAIT, ["-t", "8", "-e", "idle_prompt"], () => {
      setTimeout(() => fs.appendFileSync(events, line + "\n"), 1500);
    });
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toBe(line);
    expect(gapLinesIn(r.stderr)).toEqual(GAP_LINES);
  }, 15_000);

  it("prints no gap lines on stderr when there are none", async () => {
    const r = await run(WAIT, ["-t", "1"]);
    expect(r.code).toBe(124);
    expect(fs.existsSync(path.join(dir, "events.jsonl"))).toBe(true);
    expect(gapLinesIn(r.stderr)).toEqual([]);
  }, 15_000);
});
