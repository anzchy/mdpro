// @vitest-environment node
/**
 * D82-WI-2 (H2), the partition and the ordering law of `clean`'s si.sock step.
 * Matrix: `.claude/tdd-guardian/tests-20261010-103136.md`, D82-WI-2 CS-4, CS-5.
 *
 * Law: `si.sock` is unlinked only while `.lock` names R (or there is no lock
 * to hold), and only right after a probe said `stale`. Equivalently, a socket
 * with a live listener at the moment of the unlink is never unlinked.
 *
 * CS-5 injects one competitor (a launch: `acquireLock(B)`, then a real live
 * listener renamed onto `si.sock`) at every step boundary of both paths:
 * inside each probe call (a wrapper around the real `probeSocket`), after each
 * `deps.rmSync` call, before the `si.sock` unlink and before the lock release
 * (pass-through `vi.spyOn` on `node:fs`), and after `clean` returns.
 */
import fs from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  acquireLock,
  B,
  disposeAll,
  type Fx,
  isSocket,
  makeStaleSocket,
  mutexGate,
  N2,
  NAME,
  NONCE,
  ORPHAN_NONCE,
  orphanFixture,
  preBound,
  type Probe,
  probeSocket,
  runFixture,
  type Scan,
  scriptedProbe,
  SOCK_REMOVED,
} from "./support/cleanSockFixtures";
import { rawAcquire } from "./support/lockSchedules";

const realRename = fs.renameSync;
const realUnlink = fs.unlinkSync;

afterEach(async () => {
  vi.restoreAllMocks();
  await disposeAll();
});

describe("D82-WI-2 CS-4 re-probe × scan partition (run path, first probe stale)", () => {
  it("the socket is removed only for (re-probe stale, scan [])", async () => {
    const reprobes: Probe[] = ["stale", "live", "absent", "unknown"];
    const scans: [string, Scan][] = [
      ["[]", []],
      ["[4242]", [4242]],
      ["unknown", "unknown"],
    ];
    const got = [];
    const want = [];
    for (const re of reprobes) {
      for (const [scanId, scan] of scans) {
        const probe = scriptedProbe(["stale", re]);
        const fx = runFixture({ probe, scan });
        await makeStaleSocket(fx.siSock);
        await fx.clean();
        const cell = `${re}×${scanId}`;
        got.push({ cell, exists: isSocket(fx.siSock), sockLine: fx.out.length === 3 ? fx.out[1] : null, probes: probe.calls.length });
        if (scanId === "[]") {
          want.push(
            re === "stale"
              ? { cell, exists: false, sockLine: SOCK_REMOVED, probes: 2 }
              : { cell, exists: true, sockLine: `[info] si.sock kept: re-probe ${re}`, probes: 2 },
          );
        } else {
          const why = scanId === "unknown" ? "process scan unknown" : "verify binary running";
          want.push({ cell, exists: true, sockLine: `[info] si.sock kept: ${why}`, probes: 1 });
        }
      }
    }
    expect(got).toEqual(want);
  });
});

type Kind = "run" | "orphan";
const RM_CALLS = 7; // the fixture's 6 entries of R: 5 others, launch.json, then R itself
const boundaries = (kind: Kind) => [
  "probe#1",
  ...(kind === "run" ? Array.from({ length: RM_CALLS }, (_, k) => `rm#${k + 1}`) : []),
  "probe#2",
  "pre-sock-unlink",
  "pre-release",
  "after-return",
];

/** One clean of `kind` with the competitor injected at boundary `j`; returns any violations of the law. */
async function runAt(kind: Kind, j: string): Promise<string[]> {
  const rec = { fired: 0, acquire: "", installed: false };
  let fx: Fx | null = null;
  let pre = "";
  const fire = () => {
    if (rec.fired++ > 0 || fx === null) return;
    const f = fx;
    try {
      // rule 12: D105-WI-2. At `pre-release` the competitor fires inside clean's
      // release section (`.lock.mutex` held), where `acquireLock` is now a re-entry
      // refused at once. There it models a launch that ignores the mutex
      // (`rawAcquire`: same `wx` create, same `lock held by run X` refusal), so CS-5
      // still tests the D82-WI-2 ordering itself. Every other boundary is unchanged.
      if (j === "pre-release") rawAcquire(f.parent, B, N2);
      else acquireLock(f.parent, { run: B, nonce: N2 });
      rec.acquire = "acquired";
      realRename(pre, f.siSock);
      rec.installed = true;
    } catch (e) {
      rec.acquire = e instanceof Error ? e.message : String(e);
    }
  };
  let probes = 0;
  const probe = async (p: string): Promise<Probe> => {
    probes += 1;
    if (j === `probe#${probes}`) fire();
    return probeSocket(p);
  };
  let rms = 0;
  const rmSync = ((p: fs.PathLike, o?: fs.RmOptions) => {
    fs.rmSync(p, o);
    rms += 1;
    if (j === `rm#${rms}`) fire();
  }) as typeof fs.rmSync;
  const f: Fx = kind === "run" ? runFixture({ probe, rmSync }) : orphanFixture({ probe });
  fx = f;
  await makeStaleSocket(f.siSock);
  pre = await preBound(f.dir);
  // rule 12: D105-WI-4 (harness only; no assertion changed). The `si.sock` unlink
  // now runs inside `.lock.mutex`, where `acquireLock` is a re-entry refused at
  // once. The `pre-sock-unlink` competitor is an in-protocol launch, so it waits
  // for the mutex: `mutexGate` fires it right after the mutex unlink, still before
  // clean's release (the lock still names R). Without a mutex it fires as before.
  const gate = mutexGate(f.parent);
  vi.spyOn(fs, "unlinkSync").mockImplementation(((p: fs.PathLike) => {
    if (p === f.siSock && j === "pre-sock-unlink") gate.run(fire);
    if (p === f.lockPath && j === "pre-release") fire();
    realUnlink(p);
    gate.unlinked(p);
  }) as typeof fs.unlinkSync);
  vi.spyOn(fs, "renameSync").mockImplementation(((a: fs.PathLike, b: fs.PathLike) => {
    if (a === f.lockPath && j === "pre-release") fire();
    realRename(a, b);
  }) as typeof fs.renameSync);
  await f.clean();
  vi.restoreAllMocks();
  if (j === "after-return") fire();
  const after = await probeSocket(f.siSock);
  const v: string[] = [];
  const tag = `${kind} ${j}`;
  if (rec.fired !== 1) v.push(`${tag}: competitor fired ${rec.fired} times`);
  if (rec.installed && after !== "live") v.push(`${tag}: live listener lost (probe ${after})`);
  if ((rec.acquire === "acquired") !== (j === "after-return")) v.push(`${tag}: acquire ${rec.acquire}`);
  if (rec.acquire !== "acquired" && rec.acquire !== `lock held by run ${NAME}`) v.push(`${tag}: refused as ${rec.acquire}`);
  if (!f.out.at(-1)?.startsWith("verdict:")) v.push(`${tag}: last line ${f.out.at(-1)}`);
  if (f.out.some((l) => l.includes(NONCE) || l.includes(ORPHAN_NONCE))) v.push(`${tag}: nonce printed`);
  return v;
}

describe("D82-WI-2 CS-5 a competitor at every step boundary never loses its live socket", () => {
  it.each(["run", "orphan"] as const)("%s path: no violation at any boundary", async (kind) => {
    const violations: string[] = [];
    for (const j of boundaries(kind)) {
      violations.push(...(await runAt(kind, j)));
      await disposeAll();
    }
    expect(violations, violations.join("; ")).toEqual([]);
  });
});
