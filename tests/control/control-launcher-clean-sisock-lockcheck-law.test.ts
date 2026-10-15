// @vitest-environment node
/**
 * D105-WI-4, the law of `clean`'s lock re-check before the `si.sock` unlink
 * (`scripts/control/cleanSocket.mjs` `siSock`):
 *
 *   across every lock state at the re-check, `si.sock` is unlinked iff the
 *   lock is absent or names the run being cleaned.
 *
 * SG-5 sweeps {run, orphan, no lock} × lock at the re-check ∈ {absent, R,
 * another run, corrupt}. The state is set raw (a writer outside the lock API)
 * from inside clean's second probe call, the window between the re-probe and
 * the unlink; the probe then says `stale`. All 12 cells are compared in one
 * `toEqual`, so a failure lists every broken cell.
 * Plan and matrix: `.claude/tdd-guardian/plan-d105-20261011-144108.md`,
 * D105-WI-4 SG-5.
 */
import fs from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  disposeAll,
  type Fx,
  isSocket,
  makeStaleSocket,
  N2,
  NAME,
  OTHER,
  orphanFixture,
  type Probe,
  runFixture,
  SOCK_REMOVED,
} from "../support/cleanSockFixtures";
import { recordBytes } from "../support/lockSchedules";

afterEach(async () => {
  vi.restoreAllMocks();
  await disposeAll();
});

type Kind = "run" | "orphan" | "no lock";
type At = "absent" | "R" | "other" | "corrupt";
const KINDS: Kind[] = ["run", "orphan", "no lock"];
const STATES: At[] = ["absent", "R", "other", "corrupt"];
const KEPT: Record<At, string | null> = {
  absent: null,
  R: null,
  other: `[info] si.sock kept: lock held by run ${OTHER}`,
  corrupt: "[info] si.sock kept: lock unreadable",
};

/** Put `.lock` into `state` with raw fs calls. */
function setRaw(lockPath: string, state: At): void {
  fs.rmSync(lockPath, { force: true });
  if (state === "R") fs.writeFileSync(lockPath, recordBytes(NAME, N2), { mode: 0o600 });
  if (state === "other") fs.writeFileSync(lockPath, recordBytes(OTHER, N2), { mode: 0o600 });
  if (state === "corrupt") fs.writeFileSync(lockPath, "{", { mode: 0o600 });
}

async function cell(kind: Kind, state: At) {
  let fx: Fx | null = null;
  let calls = 0;
  const probe = async (): Promise<Probe> => {
    calls += 1;
    if (calls === 2) setRaw((fx as Fx).lockPath, state);
    return "stale";
  };
  fx = kind === "run" ? runFixture({ probe }) : orphanFixture({ probe, lock: kind === "orphan" ? "this" : "none" });
  await makeStaleSocket(fx.siSock);
  await fx.clean();
  const sockLine = fx.out.find((l) => l === SOCK_REMOVED || l.startsWith("[info] si.sock kept")) ?? null;
  return { cell: `${kind} × ${state}`, removed: !isSocket(fx.siSock), sockLine, probes: calls };
}

describe("D105-WI-4 SG-5 si.sock is unlinked iff the lock at the re-check is absent or names R", () => {
  it("all 12 cells: removed iff absent or R; the kept line names the reason", async () => {
    const got = [];
    const want = [];
    for (const kind of KINDS) {
      for (const state of STATES) {
        got.push(await cell(kind, state));
        await disposeAll();
        const kept = KEPT[state];
        want.push({ cell: `${kind} × ${state}`, removed: kept === null, sockLine: kept ?? SOCK_REMOVED, probes: 2 });
      }
    }
    expect(got).toEqual(want);
  });
});
