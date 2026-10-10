/**
 * Fixtures for the D82-WI-2 `clean` si.sock ordering tests
 * (`scripts/control/clean.mjs`, `scripts/control/cleanSocket.mjs`).
 * Shared by `control-launcher-clean-sisock*.test.ts` so the fixture shapes
 * are not copied between them.
 *
 * - `runFixture`: the clean-order shape (`control-launcher-clean-order.test.ts`):
 *   a dead owned R, a lock naming R, a short `si.sock` path.
 * - `orphanFixture`: the clean-orphan shape (`control-launcher-clean-orphan.test.ts`):
 *   no R, a lock per `lock`.
 * - `scriptedProbe`: a probe answering from a list, counting its calls.
 * - `preBound`: a real `net` listener at a sibling path, which the competitor
 *   renames onto `si.sock` (CS-0 checks the renamed socket stays live).
 *
 * Only `deps.procFacts`, `deps.uid` and `deps.rmSync` are injected; the lock,
 * the ownership verdict, the sockets and the fs are real.
 * Matrix: `.claude/tdd-guardian/tests-20261010-103136.md`, D82-WI-2.
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { LSTART, MAIN, NONCE } from "./launchHarness";
import { fakeProcFacts, makeHome, makeStaleSocket } from "./launcherFakes";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { run as cleanRun } from "../../scripts/control/clean.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { acquireLock } from "../../scripts/control/lock.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { probeSocket } from "../../scripts/control/procFacts.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { layout, runName, runsParent } from "../../scripts/control/runDir.mjs";

export type Result = { exit: number; lines: string[] };
export type Probe = "live" | "stale" | "absent" | "unknown";
export type Scan = number[] | "unknown";

export const NAME: string = runName(Buffer.alloc(16, 0x11));
export const OTHER: string = runName(Buffer.alloc(16, 0x33));
export const B: string = runName(Buffer.alloc(16, 0x44));
export const ORPHAN_NONCE = "ab".repeat(32);
export const N2 = "01".repeat(32);
export const DF = "verdict: driver failure — ";
export const FAIL = "verdict: fail — ";
export const RELEASED = `clean: absent ${NAME}; released orphan lock`;
export const ABSENT = `clean: absent ${NAME}`;
export const SOCK_REMOVED = "clean: removed stale si.sock";
export { NONCE, probeSocket, acquireLock, makeStaleSocket };

let disposers: (() => void | Promise<void>)[] = [];
export async function disposeAll(): Promise<void> {
  for (const d of disposers.reverse()) await d();
  disposers = [];
}

/** A probe answering `answers[i]` on call i (the last one repeating), or the real probe when `answers` is "real". */
export function scriptedProbe(answers: Probe[] | "real") {
  const calls: string[] = [];
  const probe = async (p: string): Promise<Probe> => {
    calls.push(p);
    if (answers === "real") return probeSocket(p);
    return answers[Math.min(calls.length - 1, answers.length - 1)];
  };
  return Object.assign(probe, { calls });
}

type Common = { scan?: Scan; probe?: (p: string) => Promise<Probe>; rmSync?: typeof fs.rmSync };

function sockDir() {
  const dir = fs.mkdtempSync("/tmp/lo");
  disposers.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function cleaner(home: string, siSock: string, o: Common, out: string[]) {
  return (run: string = NAME): Promise<Result> =>
    cleanRun(
      { run },
      {
        passwdHome: home,
        uid: process.getuid?.(),
        siSockPath: siSock,
        procFacts: fakeProcFacts({ scan: o.scan ?? [], probe: o.probe ?? ((p: string) => probeSocket(p)) }),
        ...(o.rmSync ? { rmSync: o.rmSync } : {}),
        out: (l: string) => out.push(l),
        err: (l: string) => out.push(l),
      },
    );
}

/** The clean-order fixture: a dead owned R (6 entries), a lock naming R with NONCE, `si.sock` in its own tmp dir. */
export function runFixture(o: Common & { lock?: boolean } = {}) {
  const h = makeHome();
  disposers.push(h.cleanup);
  const parent: string = runsParent(h.real);
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  const lay: Record<string, string> = layout(parent, NAME);
  fs.mkdirSync(lay.runDir, { mode: 0o700 });
  fs.chmodSync(lay.runDir, 0o700);
  fs.writeFileSync(lay.launchJson, JSON.stringify({ nonce: NONCE, buildId: "b1", mainBinary: MAIN }));
  fs.writeFileSync(lay.instanceJson, JSON.stringify({ pid: 4242, nonce: NONCE, buildId: "b1" }));
  fs.writeFileSync(lay.ownerJson, JSON.stringify({ pid: 4242, startTime: LSTART, exeRealpath: MAIN }));
  fs.writeFileSync(path.join(lay.runDir, `.instance.json.${randomUUID()}.tmp`), "{}");
  fs.mkdirSync(lay.prefsDir, { mode: 0o700 });
  fs.writeFileSync(lay.prefs, "{}");
  fs.mkdirSync(lay.drafts, { recursive: true });
  fs.writeFileSync(path.join(lay.drafts, "d1.md"), "# d1\n");
  if (o.lock !== false) acquireLock(parent, { run: NAME, nonce: NONCE });
  const dir = sockDir();
  const siSock = path.join(dir, "si.sock");
  const out: string[] = [];
  return { kind: "run" as const, parent, lay, dir, siSock, out, lockPath: path.join(parent, ".lock"), clean: cleaner(h.home, siSock, o, out) };
}

/** The clean-orphan fixture: no R; a lock naming R (ORPHAN_NONCE), another run, or none. */
export function orphanFixture(o: Common & { lock?: "this" | "none" } = {}) {
  const h = makeHome();
  disposers.push(h.cleanup);
  const parent: string = runsParent(h.real);
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  if ((o.lock ?? "this") === "this") acquireLock(parent, { run: NAME, nonce: ORPHAN_NONCE });
  const dir = sockDir();
  const siSock = path.join(dir, "si.sock");
  const out: string[] = [];
  return { kind: "orphan" as const, parent, lay: null, dir, siSock, out, lockPath: path.join(parent, ".lock"), clean: cleaner(h.home, siSock, o, out) };
}

export type Fx = ReturnType<typeof runFixture> | ReturnType<typeof orphanFixture>;

/** A real listener at `<dir>/pre.sock`; closed when the test's disposers run. */
export async function preBound(dir: string): Promise<string> {
  const p = path.join(dir, "pre.sock");
  const server = net.createServer((c) => c.destroy());
  await new Promise<void>((res) => server.listen(p, res));
  disposers.push(() => new Promise<void>((res) => server.close(() => res())));
  return p;
}

export const tombsIn = (parent: string) => fs.readdirSync(parent).filter((n) => n.endsWith(".tomb"));
export const exists = (p: string) => {
  try {
    fs.lstatSync(p);
    return true;
  } catch {
    return false;
  }
};
export const isSocket = (p: string) => exists(p) && fs.lstatSync(p).isSocket();
