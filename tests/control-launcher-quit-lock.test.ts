// @vitest-environment node
/**
 * D82-WI-5 (M4): `quit` must not report `pass` when releasing the lock failed.
 * Matrix: `.claude/tdd-guardian/tests-20261010-103136.md`, "D82-WI-5", the
 * Amendment (conditions (a) and (b)) and its round-2 addition: QU-M4-1,
 * QU-M4-2, QU-M4-3, QU-M4-4 (amended), QU-M4-5, QU-M4-6.
 *
 * Law: `verdict: pass` iff no tomb was created, our process was confirmed
 * dead, and `.lock` is absent or names another run with its bytes unchanged.
 * A non-pass never destroys the lock's bytes. One exception to "no tomb"
 * since D82-WI-9: when the tomb unlink fails after a successful restore, the
 * pass stands and a tomb (a hard link to the other run's record) is left
 * behind (QU-WI9-1 in control-launcher-lock-tomb-faults.test.ts).
 *
 * Release-point mutations run inside the scripted `alive` callback that first
 * reports death, or through the pass-through `node:fs` spies of
 * `tests/support/lockSchedules.ts`. Lines are pinned as literals.
 */
import fs from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { last, logLines, NONCE, sha256 } from "./support/launchHarness";
import { B, C, interleave, N2, N3, recordBytes } from "./support/lockSchedules";
import { atDeath, cleanupQuitFixtures, diesOn, launched, owned, PID, type Liveness, type Q, type Timeline } from "./support/quitHarness";
import { mulberry32 } from "./support/seededRandom";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { acquireLock } from "../scripts/control/lock.mjs";

const DF = "verdict: driver failure — ";
const NOT_RELEASED = `${DF}lock not released: `;
const OTHER_NONCE = "33".repeat(32);
const SECRETS = [NONCE, OTHER_NONCE, N2, N3].flatMap((n) => [n, sha256(n)]);

afterEach(() => {
  vi.restoreAllMocks();
  cleanupQuitFixtures();
});

type Death = { sig: "SIGTERM" | "SIGKILL"; how: string };
const DEATHS: Death[] = [
  { sig: "SIGTERM", how: "terminated (SIGTERM)" },
  { sig: "SIGKILL", how: "killed (SIGKILL)" },
];

/** Replace `.lock` with `{ run, nonce }`'s record, as a newcomer would. */
const swapLock = (q: Q, run: string, nonce: string) => {
  fs.unlinkSync(q.lockPath);
  acquireLock(q.fx.parent, { run, nonce });
};
const lastLog = (q: Q) => logLines(q.fx.lay.runDir).at(-1) as Record<string, unknown>;
const expectNoSecret = (q: Q) => {
  const text = q.text();
  for (const s of SECRETS) expect(text).not.toContain(s);
};

describe("D82-WI-5 quit: a release that throws is a driver failure", () => {
  it.each(DEATHS)("QU-M4-1 another nonce at the release point ($sig)", async ({ sig, how }) => {
    const q = await launched();
    const before = q.outside();
    let set = "";
    q.procs({
      [PID]: atDeath(diesOn(sig), () => {
        swapLock(q, q.fx.name, OTHER_NONCE);
        set = fs.readFileSync(q.lockPath, "utf8");
      }),
    });
    const r = await q.quit();
    expect(r.exit).toBe(1);
    expect(q.out.slice(-2)).toEqual([`quit: run ${q.fx.name} ${how}`, `${NOT_RELEASED}lock for run ${q.fx.name} holds another nonce`]);
    expect(set).toBe(recordBytes(q.fx.name, OTHER_NONCE));
    expect(q.lockState()).toBe(set);
    expect(lastLog(q)).toMatchObject({ phase: "result", outcome: how, lock: "not released" });
    expect(q.outside()).toEqual(before);
    expectNoSecret(q);
  });

  it("QU-M4-2 corrupt lock at the release point: lock unreadable", async () => {
    const q = await launched();
    q.procs({ [PID]: atDeath(diesOn("SIGTERM"), () => fs.writeFileSync(q.lockPath, "{")) });
    const r = await q.quit();
    expect(r.exit).toBe(1);
    expect(q.out.slice(-2)).toEqual([`quit: run ${q.fx.name} terminated (SIGTERM)`, `${NOT_RELEASED}lock unreadable`]);
    expect(q.lockState()).toBe("{");
    expect(q.tombs()).toEqual([]);
    expect(lastLog(q)).toMatchObject({ phase: "result", lock: "not released" });
    expectNoSecret(q);
  });
});

type LockState = "absent" | "own" | "otherNonce" | "otherRun" | "corrupt";
const STATES: LockState[] = ["absent", "own", "otherNonce", "otherRun", "corrupt"];
const EXPECTED: Record<LockState, boolean> = { absent: true, own: true, otherNonce: false, otherRun: true, corrupt: false };

function setState(q: Q, state: LockState): void {
  if (state === "absent") fs.unlinkSync(q.lockPath);
  if (state === "otherNonce") swapLock(q, q.fx.name, OTHER_NONCE);
  if (state === "otherRun") swapLock(q, B, N2);
  if (state === "corrupt") fs.writeFileSync(q.lockPath, "{");
}

const namesOther = (bytes: string | null, run: string) => {
  try {
    return bytes !== null && JSON.parse(bytes).run !== run;
  } catch {
    return false;
  }
};

describe("D82-WI-5 quit: the law over the release-point states", () => {
  it("QU-M4-3 pass iff no tomb and the lock is absent or names another run, bytes unchanged (5 x 2, order seed 2026101005)", async () => {
    const rows = STATES.flatMap((state) => DEATHS.map((death) => ({ state, death })));
    const rnd = mulberry32(2026101005);
    for (let i = rows.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rnd() * (i + 1));
      [rows[i], rows[j]] = [rows[j], rows[i]];
    }
    const seen: Record<string, boolean> = {};
    const want: Record<string, boolean> = {};
    for (const { state, death } of rows) {
      const q = await launched();
      let setBytes: string | null = null;
      q.procs({
        [PID]: atDeath(diesOn(death.sig), () => {
          setState(q, state);
          setBytes = q.lockState();
        }),
      });
      const r = await q.quit();
      const key = `${state}/${death.sig}`;
      const pass = last(q.out) === "verdict: pass";
      const final = q.lockState();
      const noTomb = q.tombs().length === 0;
      expect(pass, key).toBe(r.exit === 0);
      expect(pass, key).toBe(noTomb && (final === null || (namesOther(final, q.fx.name) && final === setBytes)));
      if (!pass) expect(final, key).toBe(setBytes);
      expect(noTomb, key).toBe(true);
      expectNoSecret(q);
      seen[key] = pass;
      want[key] = EXPECTED[state];
    }
    expect(seen).toEqual(want);
  });
});

describe("D82-WI-5 quit: a takeover after a confirmed death (Amendment (a))", () => {
  it("QU-M4-4 (amended) lock swapped to another run inside the release: takeover line, then pass", async () => {
    const q = await launched();
    q.procs({ [PID]: diesOn("SIGTERM") });
    const il = interleave(q.fx.parent, [{ at: "pre-rename", competitor: () => swapLock(q, B, N2) }]);
    let r;
    try {
      r = await q.quit();
    } finally {
      il.finish();
    }
    expect(il.fired).toEqual([1]);
    expect(r.exit).toBe(0);
    expect(q.out.slice(-2)).toEqual([`lock: held by run ${B} (ours already released)`, "verdict: pass"]);
    expect(q.out).toContain(`quit: run ${q.fx.name} terminated (SIGTERM)`);
    expect(lastLog(q)).toMatchObject({ phase: "result", lock: "taken over", by: B });
    expect(q.lockState()).toBe(recordBytes(B, N2));
    expect(q.tombs()).toEqual([]);
    expectNoSecret(q);
  });
});

describe("D82-WI-5 quit: a takeover needs our process confirmed dead (Amendment (b))", () => {
  it("QU-M4-5 (i) death confirmed, lock names another run: takeover line, then pass", async () => {
    const q = await launched();
    q.procs({ [PID]: atDeath(diesOn("SIGTERM"), () => swapLock(q, B, N2)) });
    const r = await q.quit();
    expect(r.exit).toBe(0);
    expect(q.out.slice(-3)).toEqual([`quit: run ${q.fx.name} terminated (SIGTERM)`, `lock: held by run ${B} (ours already released)`, "verdict: pass"]);
    expect(lastLog(q)).toMatchObject({ phase: "result", lock: "taken over", by: B });
    expect(q.lockState()).toBe(recordBytes(B, N2));
    expect(q.tombs()).toEqual([]);
    expectNoSecret(q);
  });

  it.each([
    ["alive", true],
    ["unknown", "unknown"],
  ] as [string, Liveness][])("QU-M4-5 (ii) liveness %s after SIGKILL, lock stolen during the stop: driver failure", async (_row, after) => {
    const q = await launched();
    let stolen = false;
    const timeline: Timeline = (_t, s) => {
      if (s.length > 0 && !stolen) {
        stolen = true;
        swapLock(q, B, N2);
      }
      return owned({ alive: s.length === 0 ? true : after });
    };
    q.procs({ [PID]: timeline });
    const r = await q.quit();
    expect(stolen).toBe(true);
    expect(r.exit).toBe(1);
    expect(last(q.out)).toBe(`${DF}lock stolen by run ${B} while run ${q.fx.name} was live`);
    expect(q.out.some((l) => l.startsWith("lock: held by run"))).toBe(false);
    expect(q.lockState()).toBe(recordBytes(B, N2));
    expect(q.tombs()).toEqual([]);
    expectNoSecret(q);
  });
});

describe("D82-WI-5 quit: a displaced release is a driver failure that keeps the tomb", () => {
  it.each(DEATHS)("QU-M4-6 two-shot schedule ($sig)", async ({ sig, how }) => {
    const q = await launched();
    q.procs({ [PID]: diesOn(sig) });
    let bBytes = "";
    let cBytes = "";
    const il = interleave(q.fx.parent, [
      {
        at: "pre-rename",
        competitor: () => {
          swapLock(q, B, N2);
          bBytes = fs.readFileSync(q.lockPath, "utf8");
        },
      },
      {
        at: "pre-link",
        competitor: () => {
          acquireLock(q.fx.parent, { run: C, nonce: N3 });
          cBytes = fs.readFileSync(q.lockPath, "utf8");
        },
      },
    ]);
    let r;
    try {
      r = await q.quit();
    } finally {
      il.finish();
    }
    expect(il.fired).toEqual([1, 1]);
    expect(r.exit).toBe(1);
    const m = /^verdict: driver failure — lock not released: lock displaced: kept (\.lock\.[^/]+\.tomb)$/.exec(String(last(q.out)));
    expect(m, String(last(q.out))).not.toBeNull();
    expect(q.out.at(-2)).toBe(`quit: run ${q.fx.name} ${how}`);
    expect(q.out.some((l) => l.startsWith("lock: held by run") || l === "verdict: pass")).toBe(false);
    const rec = lastLog(q);
    expect(rec).toMatchObject({ phase: "result", outcome: how, lock: "not released" });
    expect(rec.lock).not.toBe("taken over");
    expect(bBytes).toBe(recordBytes(B, N2));
    expect(cBytes).toBe(recordBytes(C, N3));
    expect(q.lockState()).toBe(cBytes);
    const tomb = String(m?.[1]);
    expect(q.tombs()).toEqual([tomb]);
    expect(fs.readFileSync(`${q.fx.parent}/${tomb}`, "utf8")).toBe(bBytes);
    expectNoSecret(q);
  });
});
