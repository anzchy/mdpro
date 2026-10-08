/**
 * The WI-6 `launch` fixture (matrix "Unit: launch#run", common setup): a
 * `makeHome()` passwd home, the fixed RNG (0x11 × 16 for the name, 0x22 × 32
 * for the nonce), a fake spawn whose "app" publishes `instance.json` the way
 * `publish_or_exit` does, canned procFacts for pid 4242, a recording
 * `deps.kill` and a fake clock. Shared by the launch test files; real fs.
 */
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { expect } from "vitest";
import {
  fakeClock,
  fakeProcFacts,
  fakeSpawn,
  fixedRandom,
  makeHome,
  recordingKill,
  type SpawnCall,
  type SpawnScript,
} from "./launcherFakes";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { layout, runName, runsParent } from "../../scripts/control/runDir.mjs";

export const MAIN = "/fake/mdpro-verify.app/Contents/MacOS/tauri-app";
export const BUNDLE = "/fake/mdpro-verify.app";
export const LSTART = "Thu Oct  8 14:44:44 2026";
export const NAME_BYTES = Buffer.alloc(16, 0x11);
export const NONCE = "22".repeat(32);
export const GUARD = "mdpro verify-run guard: refusing to start: ";
export const ENV_KEYS = ["HOME", "CFFIXED_USER_HOME", "MDPRO_VERIFY_RUN", "MDPRO_VERIFY_NONCE"] as const;

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const mode = (p: string) => fs.statSync(p).mode & 0o777;
export const last = (lines: string[]) => lines[lines.length - 1];

/** All-pass doctor facts. */
export const passFacts = (): Record<string, unknown> => ({
  bundlePresent: true,
  manifest: { ok: true, buildId: "b1", profile: "verify" },
  sourceTreeMatches: true,
  lock: { state: "absent" },
  verifyPids: [],
  siSock: "absent",
  leftoverRuns: [],
  leftoverTmps: [],
});

/** The 25-byte reserved socket path's length for this home (matrix R1 driver convention). */
export const expectedTotal = (home: string) =>
  Buffer.byteLength(path.join(runsParent(fs.realpathSync(home)), "0".repeat(25), "ctl.sock"));

/** Exclusive publish of `instance.json` in `runDir`: tmp file, then `link`. */
export function publish(runDir: string, body: unknown): void {
  const tmp = path.join(runDir, `.instance.json.${randomUUID()}.tmp`);
  fs.writeFileSync(tmp, typeof body === "string" ? body : JSON.stringify(body));
  try {
    fs.linkSync(tmp, path.join(runDir, "instance.json"));
  } finally {
    fs.unlinkSync(tmp);
  }
}

/** The run dir and nonce a spawn call carries: from its env, or from `open --env K=V`. */
export function callRun(call: SpawnCall): { run: string; nonce: string } {
  if (call.opts.env?.MDPRO_VERIFY_RUN) {
    return { run: call.opts.env.MDPRO_VERIFY_RUN, nonce: String(call.opts.env.MDPRO_VERIFY_NONCE) };
  }
  const kv: Record<string, string> = {};
  call.args.forEach((a, i) => {
    if (call.args[i - 1] === "--env") kv[a.slice(0, a.indexOf("="))] = a.slice(a.indexOf("=") + 1);
  });
  return { run: kv.MDPRO_VERIFY_RUN, nonce: kv.MDPRO_VERIFY_NONCE };
}

/** The "app": publishes `{nonce, pid, buildId:"b1"}` (overridable) on spawn. */
export const appPublishes =
  (over: Record<string, unknown> = {}, pid?: number): SpawnScript =>
  (call, child) => {
    const { run, nonce } = callRun(call);
    publish(run, { nonce, pid: pid ?? child.pid, buildId: "b1", ...over });
  };

/** Every file under `dir`, recursively, relative. */
export function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    out.push(path.relative(dir, p));
    if (e.isDirectory()) for (const s of walk(p)) out.push(path.join(e.name, s));
  }
  return out.sort();
}

/** matrix R1 `treeSnapshot(R)`: every entry but the two append-only logs. */
export function treeSnapshot(runDir: string) {
  return walk(runDir)
    .filter((rel) => rel !== "launcher.jsonl" && rel !== "launcher-stderr.log")
    .map((rel) => {
      const p = path.join(runDir, rel);
      const st = fs.lstatSync(p);
      const bytes = st.isFile() ? sha256(fs.readFileSync(p, "latin1")) : null;
      return { rel, bytes, mode: st.mode, mtimeMs: st.mtimeMs };
    });
}

export const fileState = (p: string) => ({ bytes: fs.readFileSync(p, "utf8"), mtimeMs: fs.statSync(p).mtimeMs });

export type FixtureOpts = {
  realBytes?: number;
  script?: SpawnScript;
  pids?: number[];
  procTable?: Parameters<typeof fakeProcFacts>[0];
  nonceBytes?: Uint8Array;
  facts?: Record<string, unknown>;
};

/** One launch fixture. `cleanup()` removes the home. */
export function launchFixture(o: FixtureOpts = {}) {
  const h = makeHome({ realBytes: o.realBytes ?? 22 });
  const clock = fakeClock();
  const spawn = fakeSpawn(o.script ?? appPublishes(), o.pids);
  const kill = recordingKill();
  const out: string[] = [];
  const err: string[] = [];
  const rng = fixedRandom([NAME_BYTES, o.nonceBytes ?? Buffer.alloc(32, 0x22)]);
  const procTable = o.procTable ?? { pids: { 4242: { alive: true, lstart: LSTART, exe: MAIN } } };
  const deps: Record<string, unknown> = {
    passwdHome: h.home,
    repoRoot: h.real,
    siSockPath: `/tmp/lsi-${process.pid}-absent.sock`,
    collectDoctorFacts: async () => o.facts ?? passFacts(),
    randomBytes: rng,
    mainBinary: MAIN,
    buildId: "b1",
    spawn,
    procFacts: fakeProcFacts(procTable),
    kill,
    now: clock.now,
    sleep: clock.sleep,
    out: (l: string) => out.push(l),
    err: (l: string) => err.push(l),
  };
  const parent: string = runsParent(h.real);
  const name: string = runName(NAME_BYTES);
  const lay: Record<string, string> = layout(parent, name);
  return { ...h, clock, spawn, kill, out, err, rng, deps, parent, name, lay };
}

export type Fixture = ReturnType<typeof launchFixture>;

/** Captures `process.env` and returns a checker that names the drifted key. */
export function envGuard() {
  const snapshot = structuredClone(process.env);
  return () => {
    for (const k of ENV_KEYS) expect(process.env[k], k).toBe(snapshot[k]);
    expect({ ...process.env }).toStrictEqual(snapshot);
  };
}

/** Text that must not carry a secret: stdout, stderr and the run's `launcher.jsonl`. */
export function launcherText(fx: Fixture, runDir = fx.lay.runDir): string {
  const log = path.join(runDir, "launcher.jsonl");
  return [...fx.out, ...fx.err, fs.existsSync(log) ? fs.readFileSync(log, "utf8") : ""].join("\n");
}

/** Every `launcher.jsonl` line is a JSON object whose `event` starts with `launcher.`. */
export function logLines(runDir: string): { event: string }[] {
  const text = fs.readFileSync(path.join(runDir, "launcher.jsonl"), "utf8");
  return text
    .split("\n")
    .filter((l) => l !== "")
    .map((l) => JSON.parse(l));
}
