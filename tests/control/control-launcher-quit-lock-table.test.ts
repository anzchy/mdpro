// @vitest-environment node
/**
 * D82 characterization (coverage gaps in `scripts/control/quit.mjs`), pinned
 * against the behaviour already implemented, not a new work item:
 *
 * 1. "stolen" (quit.mjs `run()` ~176, `holderOf` ~221) is reported only when
 *    run R held `.lock` when quit started AND another run X holds it when the
 *    stop fails. The table is lock-at-start {absent, corrupt, R, X} x
 *    lock-when-the-stop-fails {absent, corrupt, R, X}; the stop fails as
 *    `pid 4242 still alive after SIGKILL`. Quit is called with `{ run: R }`, so
 *    `pickRun` never reads the lock and `quitVerdict` has no lock check: every
 *    cell reaches the stop. (Without a run argument, "absent" and "corrupt" at
 *    start refuse in `pickRun` and "X" quits X, so R's cells need the argument.)
 * 2. The re-read in `release()` (~243-245) after a `lock names run X, not R`
 *    refusal, with `.lock` changed again between the refusal and the re-read.
 *
 * The lock and the fs are real; `deps.kill` / `deps.procFacts` are the
 * `quitHarness` fakes, and the gap-2 schedule is pass-through `node:fs` spies.
 */
import fs from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { last, logLines, NONCE, sha256 } from "../support/launchHarness";
import { B, C, N2, N3, recordBytes } from "../support/lockSchedules";
import { cleanupQuitFixtures, diesOn, launched, owned, PID, type Q, type Timeline } from "../support/quitHarness";
import { collectionCases } from "../support/collectionCases";

const DF = "verdict: driver failure — ";
const STILL_ALIVE = `pid ${PID} still alive after SIGKILL`;
const SECRETS = [NONCE, N2, N3].flatMap((n) => [n, sha256(n)]);

afterEach(() => {
  vi.restoreAllMocks();
  cleanupQuitFixtures();
});

const lastLog = (q: Q) => logLines(q.fx.lay.runDir).at(-1) as Record<string, unknown>;
const expectNoSecret = (q: Q) => {
  const text = q.text();
  for (const s of SECRETS) expect(text).not.toContain(s);
};

type Held = "absent" | "corrupt" | "R" | "X";
const HELD: Held[] = ["absent", "corrupt", "R", "X"];

/** Put `.lock` in `state`; `rBytes` is R's own record as `launch` wrote it. Returns the bytes left (null = absent). */
function put(q: Q, state: Held, rBytes: string): string | null {
  if (state === "absent") {
    fs.rmSync(q.lockPath, { force: true });
    return null;
  }
  const bytes = state === "corrupt" ? "{" : state === "R" ? rBytes : recordBytes(B, N2);
  fs.writeFileSync(q.lockPath, bytes);
  return bytes;
}

describe("D82 gap 1: quit reports a stolen lock only when R held it at start and X holds it at the failed stop", () => {
  const cells = HELD.flatMap((start) => HELD.map((atFail) => ({ start, atFail })));

  it.each(collectionCases("tests/control/control-launcher-quit-lock-table.test.ts:58", cells))("lock $start at start, $atFail when the stop fails", async ({ start, atFail }) => {
    const q = await launched();
    const name = q.fx.name;
    const rBytes = String(q.lockState());
    expect(rBytes).toBe(recordBytes(name, NONCE));
    put(q, start, rBytes);
    let swapped = false;
    let leftBytes: string | null = null;
    const timeline: Timeline = (_t, s) => {
      if (s.length > 0 && !swapped) {
        swapped = true;
        leftBytes = put(q, atFail, rBytes);
      }
      return owned({ alive: true });
    };
    q.procs({ [PID]: timeline });

    const r = await q.quit({ run: name });

    expect(swapped).toBe(true);
    expect(q.kill.signalsTo(PID)).toEqual(["SIGTERM", "SIGKILL"]);
    expect(r.exit).toBe(1);
    const rec = lastLog(q);
    if (start === "R" && atFail === "X") {
      expect(last(q.out)).toBe(`${DF}lock stolen by run ${B} while run ${name} was live`);
      expect(rec).toMatchObject({ phase: "result", outcome: STILL_ALIVE, lock: "stolen", by: B });
    } else {
      expect(last(q.out)).toBe(`${DF}${STILL_ALIVE}`);
      expect(rec).toMatchObject({ phase: "result", outcome: STILL_ALIVE });
      expect(rec).not.toHaveProperty("lock");
      expect(rec).not.toHaveProperty("by");
    }
    expect(q.out.some((l) => l.startsWith("lock: held by run") || l === "verdict: pass")).toBe(false);
    expect(q.lockState()).toBe(leftBytes);
    expect(q.tombs()).toEqual([]);
    expectNoSecret(q);
  });
});

type Reread = "absent" | "R" | "X-unchanged" | "X-third" | "corrupt";

/**
 * Pass-through spies: just before the first `renameSync(.lock)` (inside
 * `releaseLock`), swap `.lock` to B so the tomb check refuses with
 * `lock names run B, not R`; just before the next `readFileSync(.lock)` after
 * that rename (quit's re-read; `releaseLock` reads only the tomb after its
 * rename), run `reread()`. Competitor fs calls pass straight through.
 */
function schedule(q: Q, reread: () => void) {
  const real = { readFileSync: fs.readFileSync, renameSync: fs.renameSync };
  const st = { renamed: 0, reread: 0 };
  let inside = false;
  const guarded = (fn: () => void) => {
    inside = true;
    try {
      fn();
    } finally {
      inside = false;
    }
  };
  vi.spyOn(fs, "renameSync").mockImplementation(((...a: unknown[]) => {
    if (!inside && a[0] === q.lockPath && st.renamed++ === 0) guarded(() => fs.writeFileSync(q.lockPath, recordBytes(B, N2)));
    return (real.renameSync as (...x: unknown[]) => unknown)(...a);
  }) as never);
  vi.spyOn(fs, "readFileSync").mockImplementation(((...a: unknown[]) => {
    if (!inside && a[0] === q.lockPath && st.renamed > 0 && st.reread++ === 0) guarded(reread);
    return (real.readFileSync as (...x: unknown[]) => unknown)(...a);
  }) as never);
  return st;
}

describe("D82 gap 2: quit's re-read after a `lock names run X, not R` refusal", () => {
  const ROWS: { state: Reread; pass: boolean; holder?: string }[] = [
    { state: "absent", pass: true },
    { state: "X-unchanged", pass: true, holder: B },
    { state: "X-third", pass: true, holder: C },
    { state: "R", pass: false },
    { state: "corrupt", pass: false },
  ];

  it.each(ROWS)("re-read finds $state", async ({ state, pass, holder }) => {
    const q = await launched();
    const name = q.fx.name;
    const rBytes = String(q.lockState());
    q.procs({ [PID]: diesOn("SIGTERM") });
    let leftBytes: string | null = "unset";
    const st = schedule(q, () => {
      if (state === "absent") fs.rmSync(q.lockPath);
      if (state === "R") fs.writeFileSync(q.lockPath, rBytes);
      if (state === "X-third") fs.writeFileSync(q.lockPath, recordBytes(C, N3));
      if (state === "corrupt") fs.writeFileSync(q.lockPath, "{");
      leftBytes = fs.existsSync(q.lockPath) ? fs.readFileSync(q.lockPath, "utf8") : null;
    });

    const r = await q.quit({ run: name });
    vi.restoreAllMocks();

    expect(st).toEqual({ renamed: 1, reread: 1 });
    expect(q.out).toContain(`quit: run ${name} terminated (SIGTERM)`);
    const rec = lastLog(q);
    if (pass) {
      expect(r.exit).toBe(0);
      expect(last(q.out)).toBe("verdict: pass");
      if (holder !== undefined) {
        expect(q.out.slice(-2)).toEqual([`lock: held by run ${holder} (ours already released)`, "verdict: pass"]);
        expect(rec).toMatchObject({ phase: "result", lock: "taken over", by: holder });
      } else {
        expect(q.out.some((l) => l.startsWith("lock: held by"))).toBe(false);
        expect(rec).toMatchObject({ phase: "result", outcome: "terminated (SIGTERM)" });
        expect(rec).not.toHaveProperty("lock");
      }
    } else {
      expect(r.exit).toBe(1);
      expect(q.out.slice(-2)).toEqual([`quit: run ${name} terminated (SIGTERM)`, `${DF}lock not released: lock names run ${B}, not ${name}`]);
      expect(rec).toMatchObject({ phase: "result", lock: "not released" });
    }
    const want: Record<Reread, string | null> = {
      absent: null,
      R: rBytes,
      "X-unchanged": recordBytes(B, N2),
      "X-third": recordBytes(C, N3),
      corrupt: "{",
    };
    expect(leftBytes).toBe(want[state]);
    expect(q.lockState()).toBe(want[state]);
    expect(q.tombs()).toEqual([]);
    expectNoSecret(q);
  });
});
