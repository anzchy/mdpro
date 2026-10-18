// @vitest-environment node
/**
 * ADR-0047 WI-009 round-2 audit fixes (PR #500, H1 and H2): stopping the
 * release app touches only what this run created.
 * - H1: the single-instance socket is unlinked only when it is still the
 *   one `waitReady` saw (same dev and ino); a socket another mdpro bound
 *   after ours exited, or one we never saw, is left alone.
 * - H2: every signal is preceded by a check that the pid is still the
 *   process we launched (start time and executable, as `quit.mjs` does); a
 *   reused or unknown pid gets no signal.
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { ownsSock, sockId, stopOwned } from "../../scripts/control/releaseCleanStop.mjs";

const OWNER = { startTime: "Sun Oct 18 10:00:00 2026", exe: "/x/mdpro.app/Contents/MacOS/tauri-app" };
const stat = (socket: boolean, dev = 1, ino = 42) => ({ isSocket: () => socket, dev, ino });

describe("H1: sockId and ownsSock", () => {
  it("takes the dev and ino of a socket", () => {
    expect(sockId(stat(true, 7, 9))).toEqual({ dev: 7, ino: 9 });
  });

  it.each([
    ["no stat (absent)", null],
    ["a stat that is not a socket", stat(false)],
  ])("has no identity for %s", (_, st) => {
    expect(sockId(st)).toBeNull();
  });

  it("owns the socket it recorded", () => {
    expect(ownsSock({ dev: 1, ino: 42 }, { dev: 1, ino: 42 })).toBe(true);
  });

  it.each([
    ["an ino mismatch (another app bound the path)", { dev: 1, ino: 42 }, { dev: 1, ino: 43 }],
    ["a dev mismatch", { dev: 1, ino: 42 }, { dev: 2, ino: 42 }],
    ["a socket never seen by waitReady", null, { dev: 1, ino: 42 }],
    ["a path that is gone or no longer a socket", { dev: 1, ino: 42 }, null],
  ])("does not own it on %s", (_, recorded, current) => {
    expect(ownsSock(recorded, current)).toBe(false);
  });
});

/** A fake process: liveness per poll, identity per read, and every signal sent. */
function proc(opts: {
  alive?: Array<boolean | "unknown">;
  ids?: Array<{ startTime: string; exe: string }>;
  diesOn?: "SIGTERM" | "SIGKILL" | "never";
}) {
  const signals: string[] = [];
  let dead = false;
  const aliveSeq = [...(opts.alive ?? [])];
  const ids = [...(opts.ids ?? [OWNER])];
  let t = 0;
  const d = {
    procFacts: {
      alive: async () => (dead ? false : (aliveSeq.length > 0 ? aliveSeq.shift() : true)),
      lstart: async () => ids[0].startTime,
      exe: async () => {
        const id = ids.length > 1 ? ids.shift()! : ids[0];
        return id.exe;
      },
    },
    kill: (_pid: number, sig: string) => {
      signals.push(sig);
      if (opts.diesOn === sig) dead = true;
    },
    sleep: async () => {
      t += 100;
    },
    now: () => t,
    termMs: 1000,
    killMs: 1000,
  };
  return { d, signals };
}

describe("H2: stopOwned signals only the process it launched", () => {
  it("sends SIGTERM to its own process and stops there when it exits", async () => {
    const { d, signals } = proc({ diesOn: "SIGTERM" });
    await stopOwned(d, 501, OWNER);
    expect(signals).toEqual(["SIGTERM"]);
  });

  it("escalates to SIGKILL only after re-checking identity", async () => {
    const { d, signals } = proc({ diesOn: "SIGKILL" });
    await stopOwned(d, 501, OWNER);
    expect(signals).toEqual(["SIGTERM", "SIGKILL"]);
  });

  it("sends nothing when the pid is already another process", async () => {
    const { d, signals } = proc({ ids: [{ ...OWNER, startTime: "Sun Oct 18 10:05:00 2026" }] });
    await stopOwned(d, 501, OWNER);
    expect(signals).toEqual([]);
  });

  it("sends no SIGKILL when the pid was reused during the SIGTERM grace", async () => {
    const reused = { startTime: "Sun Oct 18 10:05:00 2026", exe: "/usr/bin/other" };
    const { d, signals } = proc({ ids: [OWNER, reused], diesOn: "never" });
    await stopOwned(d, 501, OWNER);
    expect(signals).toEqual(["SIGTERM"]);
  });

  it("sends nothing and throws when the identity cannot be read", async () => {
    const { d, signals } = proc({ ids: [{ startTime: "unknown", exe: "unknown" }] });
    await expect(stopOwned(d, 501, OWNER)).rejects.toThrow("pid 501: identity unknown, not signalled");
    expect(signals).toEqual([]);
  });

  it("sends nothing and throws when no identity was recorded at launch", async () => {
    const { d, signals } = proc({});
    await expect(stopOwned(d, 501, null)).rejects.toThrow("pid 501: identity unknown, not signalled");
    expect(signals).toEqual([]);
  });

  it("sends nothing to a process that has already exited (a second stop is a no-op)", async () => {
    const { d, signals } = proc({ alive: [false] });
    await stopOwned(d, 501, OWNER);
    expect(signals).toEqual([]);
  });

  it("throws when its own process survives SIGKILL", async () => {
    const { d, signals } = proc({ diesOn: "never" });
    await expect(stopOwned(d, 501, OWNER)).rejects.toThrow("pid 501 still alive after SIGKILL");
    expect(signals).toEqual(["SIGTERM", "SIGKILL"]);
  });
});
