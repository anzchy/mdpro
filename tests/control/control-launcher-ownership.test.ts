// @vitest-environment node
/**
 * ADR-0047 WI-003 WI-3: the ownership verdicts `quit` and `clean` decide on
 * (`scripts/control/ownership.mjs`, pure, never mocked anywhere).
 * Matrix: `.claude/tdd-guardian/tests-20261008-144444.md`, WI-3, O-01..O-10.
 *
 * Check names and their order are pinned here as literals, never imported.
 */
import { describe, expect, it } from "vitest";
import {
  cleanVerdict,
  quitVerdict,
  // @ts-expect-error -- plain ESM script, no .d.ts by design
} from "../../scripts/control/ownership.mjs";
import { bytes, mulberry32 } from "../support/seededRandom";

type Facts = Record<string, unknown>;
type Verdict = { ok: boolean; failed?: string[] };

const QUIT_NAMES = ["nonce", "pid", "alive", "startTime", "exe"];
const CLEAN_NAMES = [
  "realpathUnderParent",
  "notSymlink",
  "owner",
  "mode",
  "launchJson",
  "noLiveProcess",
  "lock",
];

const N = "ab".repeat(32);
const G: Facts = Object.freeze({
  launchNonce: N,
  instanceNonce: N,
  ownerPid: 4242,
  instancePid: 4242,
  pidAlive: true,
  psStartTime: "Thu Oct  8 14:44:44 2026",
  recordedStartTime: "Thu Oct  8 14:44:44 2026",
  exeRealpath: "/A/tauri-app",
  recordedExeRealpath: "/A/tauri-app",
});

/** The O-02 single faults, in check order (bit i = QUIT_NAMES[i]). */
const QUIT_FAULTS: Facts[] = [
  { instanceNonce: "cd".repeat(32) },
  { instancePid: 5151 },
  { pidAlive: false },
  { psStartTime: "Thu Oct  8 14:44:45 2026" },
  { exeRealpath: "/B/tauri-app" },
];

const C: Facts = Object.freeze({
  realpathUnderParent: true,
  isSymlink: false,
  ownerUidMatches: true,
  modeIs0700: true,
  hasLauncherLaunchJson: true,
  ownedLiveProcess: false,
  lockState: "absent",
});

/** The O-08 single faults, in check order (bit i = CLEAN_NAMES[i]). */
const CLEAN_FAULTS: Facts[] = [
  { realpathUnderParent: false },
  { isSymlink: true },
  { ownerUidMatches: false },
  { modeIs0700: false },
  { hasLauncherLaunchJson: false },
  { ownedLiveProcess: true },
  { lockState: "otherRun" },
];

function withMask(base: Facts, faults: Facts[], mask: number): Facts {
  let out: Facts = { ...base };
  faults.forEach((f, i) => {
    if (mask & (1 << i)) out = { ...out, ...f };
  });
  return out;
}

const namesOf = (names: string[], mask: number) => names.filter((_, i) => mask & (1 << i));

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");

describe("ownership#quitVerdict", () => {
  it("O-01 all good facts proceed with exactly { ok: true }", () => {
    expect(quitVerdict({ ...G })).toStrictEqual({ ok: true });
  });

  it.each(QUIT_NAMES.map((name, i) => [name, QUIT_FAULTS[i]] as const))(
    "O-02 single fault %s fails that check alone",
    (name, fault) => {
      expect(quitVerdict({ ...G, ...fault })).toStrictEqual({ ok: false, failed: [name] });
    },
  );

  it.each([
    ["A undefined nonces", { instanceNonce: undefined, launchNonce: undefined }, "nonce"],
    ["B null start times", { psStartTime: null, recordedStartTime: null }, "startTime"],
    ["C null exe paths", { exeRealpath: null, recordedExeRealpath: null }, "exe"],
    ["D unknown start times", { psStartTime: "unknown", recordedStartTime: "unknown" }, "startTime"],
    ["E unknown liveness", { pidAlive: "unknown" }, "alive"],
    ["F null pids", { ownerPid: null, instancePid: null }, "pid"],
    ["G string owner pid", { ownerPid: "4242", instancePid: 4242 }, "pid"],
    ["H zero pids", { ownerPid: 0, instancePid: 0 }, "pid"],
    ["I negative pids", { ownerPid: -1, instancePid: -1 }, "pid"],
  ] as const)("O-03 row %s never compares equal", (_row, change, name) => {
    expect(quitVerdict({ ...G, ...change })).toStrictEqual({ ok: false, failed: [name] });
  });

  it("O-04 pid reuse is named by startTime and exe, and exe alone catches a same-second reuse", () => {
    expect(
      quitVerdict({ ...G, psStartTime: "Fri Oct  9 08:00:00 2026", exeRealpath: "/usr/bin/vim" }),
    ).toStrictEqual({ ok: false, failed: ["startTime", "exe"] });
    expect(quitVerdict({ ...G, exeRealpath: "/usr/bin/vim" })).toStrictEqual({
      ok: false,
      failed: ["exe"],
    });
  });

  it("O-05 exhaustive 2^5 sweep: ok iff no fault, failed names every fault in order, monotonic", () => {
    const failedBy: string[][] = [];
    for (let mask = 0; mask < 32; mask++) {
      const v: Verdict = quitVerdict(withMask(G, QUIT_FAULTS, mask));
      expect(v.ok).toBe(mask === 0);
      if (mask === 0) expect(v).toStrictEqual({ ok: true });
      else expect(v).toStrictEqual({ ok: false, failed: namesOf(QUIT_NAMES, mask) });
      failedBy[mask] = v.failed ?? [];
    }
    for (let m1 = 0; m1 < 32; m1++) {
      for (let m2 = 0; m2 < 32; m2++) {
        if ((m1 & m2) !== m1) continue;
        for (const name of failedBy[m1]) expect(failedBy[m2]).toContain(name);
        if (m1 !== 0) expect(quitVerdict(withMask(G, QUIT_FAULTS, m2)).ok).toBe(false);
      }
    }
  });

  it("O-06 the verdict never contains a nonce value (seed 2026100805)", () => {
    const r = mulberry32(2026100805);
    for (let i = 0; i < 200; i++) {
      const n1 = hex(bytes(r, 32));
      const n2 = hex(bytes(r, 32));
      expect(n1).not.toBe(n2);
      for (let mask = 0; mask < 32; mask++) {
        const facts = {
          ...withMask(G, QUIT_FAULTS, mask),
          launchNonce: n1,
          instanceNonce: mask & 1 ? n2 : n1,
        };
        const text = JSON.stringify(quitVerdict(facts));
        expect(text).not.toContain(n1);
        expect(text).not.toContain(n2);
      }
    }
  });
});

describe("ownership: missing facts (added at green)", () => {
  it.each([undefined, null])("facts %s refuse every check in order", (facts) => {
    expect(quitVerdict(facts)).toStrictEqual({ ok: false, failed: QUIT_NAMES });
    expect(cleanVerdict(facts)).toStrictEqual({ ok: false, failed: CLEAN_NAMES });
  });
});

describe("ownership#cleanVerdict", () => {
  it.each(["absent", "thisRun"])("O-07 all good facts proceed with lockState %s", (lockState) => {
    expect(cleanVerdict({ ...C, lockState })).toStrictEqual({ ok: true });
  });

  it.each([
    ...CLEAN_NAMES.map((name, i) => [name, CLEAN_FAULTS[i]] as const),
    ["lock", { lockState: "corrupt" }] as const,
  ])("O-08 single fault %s fails that precondition alone (%o)", (name, fault) => {
    expect(cleanVerdict({ ...C, ...fault })).toStrictEqual({ ok: false, failed: [name] });
  });

  it.each([
    [{ ownedLiveProcess: "unknown" }, "noLiveProcess"],
    [{ isSymlink: "unknown" }, "notSymlink"],
  ] as const)("O-09 unknown fact %o refuses as %s", (change, name) => {
    expect(cleanVerdict({ ...C, ...change })).toStrictEqual({ ok: false, failed: [name] });
  });

  it("O-10 exhaustive 2^7 sweep: ok iff no fault, failed names every fault in order, monotonic", () => {
    const failedBy: string[][] = [];
    for (let mask = 0; mask < 128; mask++) {
      const v: Verdict = cleanVerdict(withMask(C, CLEAN_FAULTS, mask));
      expect(v.ok).toBe(mask === 0);
      if (mask === 0) expect(v).toStrictEqual({ ok: true });
      else expect(v).toStrictEqual({ ok: false, failed: namesOf(CLEAN_NAMES, mask) });
      failedBy[mask] = v.failed ?? [];
    }
    for (let m = 0; m < 128; m++) {
      for (let b = 0; b < 7; b++) {
        const bit = 1 << b;
        if (m & bit) continue;
        const worse: Verdict = cleanVerdict(withMask(C, CLEAN_FAULTS, m | bit));
        expect(worse.ok).toBe(false);
        const after = worse.failed ?? [];
        for (const name of failedBy[m]) expect(after).toContain(name);
        expect(after.length).toBeGreaterThan(failedBy[m].length);
      }
    }
  });
});
