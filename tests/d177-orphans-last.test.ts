// @vitest-environment node
/**
 * D177-WI-4: last-dtrack.sh and wait-dtrack.sh report the orphan count.
 *
 * After a source's gap lines (`missing seq …`, `dead N`), `orphans N (source)`
 * is printed when gaps.json has `orphans` > 0: on stdout for last, on stderr
 * for wait (on a match and on a timeout). A missing or 0 `orphans` prints
 * nothing, so the WI-1..3 output is unchanged.
 *
 * Boundaries: a temp HOME and a separate temp hook dir (MDPRO_HOOK_DIR).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LAST, WAIT, makeTemp, rmTemp } from "./support/d177Hooks";

let home: string;
let dir: string;

function run(script: string, args: string[]) {
  return spawnSync("bash", [script, ...args], {
    env: { ...process.env, HOME: home, MDPRO_HOOK_DIR: dir },
    encoding: "utf8",
    timeout: 10_000,
  });
}

const reportLines = (text: string) => text.split("\n").filter((l) => /^(missing seq|dead|orphans) /.test(l));
const writeGaps = (gaps: unknown) => fs.writeFileSync(path.join(dir, "gaps.json"), JSON.stringify(gaps));

const GAPS = {
  "dtrack-mini": { epoch: "epochAAAA1111", max: 9, missing: [3, 4], dead: 2, orphans: 5 },
  "other.src": { epoch: "epochBBBB2222", max: 4, missing: [], dead: 0, orphans: 1 },
  "quiet.src": { epoch: "epochCCCC3333", max: 2, missing: [], dead: 0, orphans: 0 },
};
const EXPECTED = ["missing seq 3..4 (dtrack-mini)", "dead 2 (dtrack-mini)", "orphans 5 (dtrack-mini)", "orphans 1 (other.src)"];

beforeEach(() => {
  home = makeTemp("orph-home");
  dir = makeTemp("orph-dir");
  fs.writeFileSync(path.join(dir, "latest.json"), JSON.stringify({ hook_event_name: "Stop", session_id: "s-1" }) + "\n");
});

afterEach(() => {
  rmTemp(home);
  rmTemp(dir);
});

describe("D177-WI-4 orphan lines", () => {
  it("last prints orphans N after the gap and dead lines, per source, and nothing for 0", () => {
    writeGaps(GAPS);
    const r = run(LAST, []);
    expect(r.status).toBe(0);
    expect(reportLines(r.stdout)).toEqual(EXPECTED);
  });

  it("last prints the WI-1..3 lines unchanged when no source has orphans", () => {
    writeGaps({ "dtrack-mini": { epoch: "epochAAAA1111", max: 9, missing: [3, 4], dead: 2 } });
    const r = run(LAST, []);
    expect(reportLines(r.stdout)).toEqual(["missing seq 3..4 (dtrack-mini)", "dead 2 (dtrack-mini)"]);
  });

  it("wait prints the orphan lines on stderr on a timeout", () => {
    writeGaps(GAPS);
    const r = run(WAIT, ["-t", "1"]);
    expect(r.status).toBe(124);
    expect(reportLines(r.stderr)).toEqual(EXPECTED);
  }, 15_000);

  it("wait prints the orphan lines on stderr on a match", () => {
    writeGaps(GAPS);
    const line = JSON.stringify({ hook_event_name: "Stop", session_id: "s-2" });
    fs.writeFileSync(path.join(dir, "events.jsonl"), "");
    const child = spawnSync(
      "bash",
      ["-c", `( sleep 1; printf '%s\\n' '${line}' >> "$MDPRO_HOOK_DIR/events.jsonl" ) & bash "${WAIT}" -t 8 -e Stop`],
      { env: { ...process.env, HOME: home, MDPRO_HOOK_DIR: dir }, encoding: "utf8", timeout: 12_000 },
    );
    expect(child.status).toBe(0);
    expect(child.stdout.trim()).toBe(line);
    expect(reportLines(child.stderr)).toEqual(EXPECTED);
  }, 15_000);
});
