// @vitest-environment node
/**
 * ADR-0047 WI-003 WI-8: `clean <run>` — the driver `run(args, deps)`.
 * Matrix: `.claude/tdd-guardian/tests-20261008-144444.md`, "Unit: clean#run",
 * CL-01..CL-09 (CL-08 rows A-I); Round 3 (WI-R1) adds CL-R10 here and
 * CL-R1..CL-R9 in `control-launcher-clean-orphan.test.ts`.
 * Post-red addition: CL-R11 (the release that can fail after R is removed).
 *
 * Fixture: a dead owned run R built by hand under a `makeHome()` home: mode
 * 0700, a launcher `launch.json`, `instance.json` + `owner.json` (pid 4242),
 * a `.instance.json.*.tmp` leftover, and a real `.lock` naming R. Only
 * `deps.procFacts` (liveness, scan; the probe too unless a case uses a real
 * socket) and `deps.uid` are injected; the ownership verdict, the lock and
 * the fs are real. Verdict lines are pinned as literals, never imported.
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { last, LSTART, MAIN, NONCE, sha256, walk } from "../support/launchHarness";
import { fakeProcFacts, makeHome, makeStaleSocket } from "../support/launcherFakes";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { run as cleanRun } from "../../scripts/control/clean.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { acquireLock } from "../../scripts/control/lock.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { probeSocket } from "../../scripts/control/procFacts.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { layout, runName, runsParent } from "../../scripts/control/runDir.mjs";

type Result = { exit: number; lines: string[] };
type ProcTable = NonNullable<Parameters<typeof fakeProcFacts>[0]>;
type Inst = { pid: number; nonce: string } | null;

const OWNER_PID = 4242;
const INST_PID = 5151;
const OTHER_VERIFY = 7777;
const NAME: string = runName(Buffer.alloc(16, 0x11));
const OTHER: string = runName(Buffer.alloc(16, 0x33));
const FAIL = "verdict: fail — ";

let disposers: (() => void)[] = [];
afterEach(() => {
  for (const d of disposers.reverse()) d();
  disposers = [];
});
const tmpDir = (prefix: string) => {
  const d = fs.mkdtempSync(prefix);
  disposers.push(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
};

/** A run dir with the launcher's records; `owner: false` / `instance: null` omit them. */
function makeRun(parent: string, name: string, o: { owner?: boolean; instance?: Inst } = {}) {
  const lay: Record<string, string> = layout(parent, name);
  fs.mkdirSync(lay.runDir, { mode: 0o700 });
  fs.chmodSync(lay.runDir, 0o700);
  fs.writeFileSync(lay.launchJson, JSON.stringify({ nonce: NONCE, buildId: "b1", mainBinary: MAIN }));
  const inst = o.instance === undefined ? { pid: OWNER_PID, nonce: NONCE } : o.instance;
  if (inst) fs.writeFileSync(lay.instanceJson, JSON.stringify({ ...inst, buildId: "b1" }));
  if (o.owner !== false) {
    fs.writeFileSync(lay.ownerJson, JSON.stringify({ pid: OWNER_PID, startTime: LSTART, exeRealpath: MAIN }));
  }
  fs.writeFileSync(path.join(lay.runDir, `.instance.json.${randomUUID()}.tmp`), "{}");
  fs.mkdirSync(lay.prefsDir, { mode: 0o700 });
  fs.writeFileSync(lay.prefs, "{}");
  fs.mkdirSync(lay.drafts, { recursive: true });
  fs.writeFileSync(path.join(lay.drafts, "d1.md"), "# d1\n");
  return lay;
}

type FxOpts = { owner?: boolean; instance?: Inst; procs?: ProcTable; realSocket?: boolean };

/** The CL fixture: home, runs parent, R, a lock naming R, a short si.sock path. */
function fixture(o: FxOpts = {}) {
  const h = makeHome();
  disposers.push(h.cleanup);
  const parent: string = runsParent(h.real);
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  const lay = makeRun(parent, NAME, o);
  acquireLock(parent, { run: NAME, nonce: NONCE });
  const sockDir = tmpDir("/tmp/ls");
  const siSock = path.join(sockDir, "si.sock");
  const out: string[] = [];
  const procs = { scan: [], ...o.procs } as ProcTable;
  const deps: Record<string, unknown> = {};
  const clean = (args: Record<string, unknown> = { run: NAME }): Promise<Result> =>
    cleanRun(args, {
      passwdHome: h.home,
      uid: process.getuid?.(),
      siSockPath: siSock,
      procFacts: fakeProcFacts(o.realSocket ? { ...procs, probe: (p: string) => probeSocket(p) } : procs),
      now: () => 0,
      out: (l: string) => out.push(l),
      err: (l: string) => out.push(l),
      ...deps,
    });
  const fx = { ...h, parent, lay, sockDir, siSock, out, lockPath: path.join(parent, ".lock"), deps, roots: [] as string[], clean };
  return fx;
}
type Fx = ReturnType<typeof fixture>;

/** Every entry under `root` (never through a link): rel, mode, mtime, size, content. */
function snapshot(root: string) {
  return walk(root).map((rel) => {
    const p = path.join(root, rel);
    const st = fs.lstatSync(p);
    const content = st.isFile() ? sha256(fs.readFileSync(p, "latin1")) : st.isSymbolicLink() ? fs.readlinkSync(p) : null;
    return { rel, mode: st.mode, mtimeMs: st.mtimeMs, size: st.size, content };
  });
}
/** Like `snapshot`, but directories carry no mtime: an unlink in them legitimately changes it. */
const shape = (root: string, skip: (rel: string) => boolean) =>
  snapshot(root)
    .filter((e) => !skip(e.rel))
    // Nor size: on APFS a directory's size tracks its entry count (post-red helper fix).
    .map((e) => (fs.lstatSync(path.join(root, e.rel)).isDirectory() ? { ...e, mtimeMs: null, size: null } : e));

/** A dir outside the home holding `keep.txt` ("k") and `sub/f`. */
function outsideDir() {
  const outside = tmpDir("/tmp/out-");
  fs.writeFileSync(path.join(outside, "keep.txt"), "k");
  fs.mkdirSync(path.join(outside, "sub"));
  fs.writeFileSync(path.join(outside, "sub", "f"), "f");
  return outside;
}

type Row = {
  id: string;
  line: string;
  opts?: FxOpts;
  setup?: (fx: Fx) => void;
  args?: Record<string, unknown>;
};

const live = { alive: true as const, lstart: LSTART, exe: MAIN };

/** CL-02: each produces exactly one named fault. */
const CL02: Row[] = [
  { id: "owner", line: `${FAIL}ownership: owner`, setup: (fx) => (fx.deps.uid = (process.getuid?.() ?? 0) + 1) },
  { id: "mode", line: `${FAIL}ownership: mode`, setup: (fx) => fs.chmodSync(fx.lay.runDir, 0o755) },
  { id: "launchJson missing", line: `${FAIL}ownership: launchJson`, setup: (fx) => fs.unlinkSync(fx.lay.launchJson) },
  {
    id: "launchJson without nonce",
    line: `${FAIL}ownership: launchJson`,
    setup: (fx) => fs.writeFileSync(fx.lay.launchJson, JSON.stringify({ foo: 1 })),
  },
  { id: "live process", line: `${FAIL}ownership: noLiveProcess`, opts: { procs: { pids: { [OWNER_PID]: live } } } },
  {
    id: "lock other run",
    line: `${FAIL}ownership: lock`,
    setup: (fx) => {
      fs.unlinkSync(fx.lockPath);
      acquireLock(fx.parent, { run: OTHER, nonce: "44".repeat(32) });
    },
  },
  { id: "lock corrupt", line: `${FAIL}ownership: lock`, setup: (fx) => fs.writeFileSync(fx.lockPath, "{") },
];

/** CL-03: R replaced by a symlink to an outside copy of itself. */
const CL03: Row = {
  id: "run dir is a symlink",
  line: `${FAIL}ownership: realpathUnderParent, notSymlink`,
  setup: (fx) => {
    const outside = outsideDir();
    fs.cpSync(fx.lay.runDir, outside, { recursive: true });
    fs.chmodSync(outside, 0o700);
    fs.rmSync(fx.lay.runDir, { recursive: true });
    fs.symlinkSync(outside, fx.lay.runDir);
    fx.roots.push(outside);
  },
};

/** CL-07: names `layout` rejects. */
const CL07: Row[] = ["../x", "", "A".repeat(25), "a".repeat(24), "a".repeat(26), ".lock", "a/b"].map((name) => ({
  id: `invalid name ${JSON.stringify(name)}`,
  line: `${FAIL}invalid run name`,
  args: { run: name },
}));

const INST = { pid: INST_PID, nonce: NONCE };
type Alive = boolean | "unknown";
const noOwner = (instance: Inst, alive: Alive | null, scan: number[] | "unknown"): FxOpts => ({
  owner: false,
  instance,
  procs: { scan, ...(alive === null ? {} : { pids: { [INST_PID]: { alive } } }) },
});

/** CL-08 refusal rows: no owner.json. */
const CL08_REFUSE: Row[] = ([
  ["A", noOwner(INST, true, [])],
  ["B", noOwner(INST, false, [INST_PID])],
  ["C", noOwner(INST, false, [OTHER_VERIFY])],
  ["D", noOwner(INST, false, "unknown")],
  ["E", noOwner(INST, "unknown", [])],
  ["H", noOwner(null, null, "unknown")],
  ["I", noOwner(null, null, [OTHER_VERIFY])],
] as [string, FxOpts][]).map(([id, opts]) => ({ id: `CL-08 ${id}`, line: `${FAIL}ownership: noLiveProcess`, opts }));

/** Snapshot roots for a refusal: the home (holds parent and lock), the si.sock dir, any outside dir. */
const refusalRoots = (fx: Fx) => [fx.real, fx.sockDir, ...fx.roots];

async function expectRefused(fx: Fx, row: Row) {
  const roots = refusalRoots(fx);
  const before = roots.map(snapshot);
  const env = { ...process.env };
  const r = await fx.clean(row.args);
  expect(last(fx.out)).toBe(row.line);
  expect(r.exit).toBe(1);
  expect(roots.map(snapshot)).toEqual(before);
  expect({ ...process.env }).toEqual(env);
  expect(fx.out.join("\n")).not.toContain(NONCE);
  return r;
}

describe("WI-8 clean#run success", () => {
  it("CL-01 removes R with its tmp leftovers and nested dirs, releases its lock, leaves the rest", async () => {
    const fx = fixture();
    const sibling = makeRun(fx.parent, OTHER);
    const siblingBefore = snapshot(sibling.runDir);
    const notR = (rel: string) => rel.includes(NAME) || path.basename(rel) === ".lock";
    const outsideBefore = shape(fx.real, notR);
    const env = { ...process.env };
    const r = await fx.clean();
    expect(fs.existsSync(fx.lay.runDir)).toBe(false);
    expect(fs.existsSync(fx.lockPath)).toBe(false);
    expect(fx.out).toEqual([`clean: removed ${NAME}`, "verdict: pass"]);
    expect(r.exit).toBe(0);
    expect(snapshot(sibling.runDir)).toEqual(siblingBefore);
    expect(shape(fx.real, notR)).toEqual(outsideBefore);
    expect({ ...process.env }).toEqual(env);
    expect(fx.out.join("\n")).not.toContain(NONCE);
  });

  it("CL-04 inner symlinks to an outside file and dir are unlinked, never traversed", async () => {
    const fx = fixture();
    const outside = outsideDir();
    fs.symlinkSync(path.join(outside, "keep.txt"), path.join(fx.lay.runDir, "link"));
    fs.symlinkSync(outside, path.join(fx.lay.runDir, "dirlink"));
    const before = snapshot(outside);
    const r = await fx.clean();
    expect(r.exit).toBe(0);
    expect(fs.existsSync(fx.lay.runDir)).toBe(false);
    expect(fs.readFileSync(path.join(outside, "keep.txt"), "utf8")).toBe("k");
    expect(fs.existsSync(path.join(outside, "sub", "f"))).toBe(true);
    expect(snapshot(outside)).toEqual(before);
  });

  it("CL-06 idempotent: a second clean of R reports absent, exits 0 and changes nothing", async () => {
    const fx = fixture();
    const first = await fx.clean();
    expect(first.exit).toBe(0);
    const before = snapshot(fx.real);
    fx.out.length = 0;
    const second = await fx.clean();
    expect(fx.out).toEqual([`clean: absent ${NAME}`, "verdict: pass"]);
    expect(second.exit).toBe(0);
    expect(snapshot(fx.real)).toEqual(before);
  });

  it("CL-06 (addition) a run under a home with no runs parent is absent, and nothing is created", async () => {
    const h = makeHome();
    disposers.push(h.cleanup);
    const before = snapshot(h.real);
    const out: string[] = [];
    const r: Result = await cleanRun(
      { run: NAME },
      { passwdHome: h.home, uid: process.getuid?.(), siSockPath: "/tmp/lsi-none.sock", procFacts: fakeProcFacts(), out: (l: string) => out.push(l) },
    );
    expect(out).toEqual([`clean: absent ${NAME}`, "verdict: pass"]);
    expect(r.exit).toBe(0);
    expect(snapshot(h.real)).toEqual(before);
  });
});

describe("WI-8 clean#run refusals leave the tree unchanged", () => {
  it.each(CL02.map((row) => [row.id, row] as const))("CL-02 %s", async (_id, row) => {
    const fx = fixture(row.opts);
    row.setup?.(fx);
    await expectRefused(fx, row);
    expect(fs.existsSync(fx.lay.runDir)).toBe(true);
    if (row.id === "lock corrupt") expect(fs.readFileSync(fx.lockPath, "utf8")).toBe("{");
  });

  it("CL-03 R replaced by a symlink: refused, the link and its target untouched", async () => {
    const fx = fixture();
    CL03.setup?.(fx);
    await expectRefused(fx, CL03);
    expect(fs.lstatSync(fx.lay.runDir).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(path.join(fx.roots[0], "keep.txt"), "utf8")).toBe("k");
  });

  it.each(CL07.map((row) => [row.id, row] as const))("CL-07 %s never touches the fs", async (_id, row) => {
    const fx = fixture();
    const before = snapshot(path.dirname(fx.parent));
    await expectRefused(fx, row);
    expect(snapshot(path.dirname(fx.parent))).toEqual(before);
  });

  it("CL-07 (addition) no run named: invalid run name, exit 1", async () => {
    const fx = fixture();
    await expectRefused(fx, { id: "none", line: `${FAIL}invalid run name`, args: {} });
  });
});

describe("WI-8 clean#run CL-08 no owner.json: instance.json's pid and the scan decide", () => {
  it.each(CL08_REFUSE.map((row) => [row.id, row] as const))("%s refuses", async (_id, row) => {
    const fx = fixture(row.opts);
    await expectRefused(fx, row);
    expect(fs.existsSync(fx.lay.runDir)).toBe(true);
  });

  it.each([
    ["F", noOwner(INST, false, [])],
    ["G", noOwner(null, null, [])],
  ])("CL-08 %s removes R", async (_id, opts) => {
    const fx = fixture(opts);
    const r = await fx.clean();
    expect(fx.out).toEqual([`clean: removed ${NAME}`, "verdict: pass"]);
    expect(r.exit).toBe(0);
    expect(fs.existsSync(fx.lay.runDir)).toBe(false);
    expect(fs.existsSync(fx.lockPath)).toBe(false);
  });
});

describe("WI-8 clean#run si.sock (real sockets)", () => {
  it("CL-05 A stale socket and scan []: removed after R", async () => {
    const fx = fixture({ realSocket: true });
    await makeStaleSocket(fx.siSock);
    const r = await fx.clean();
    expect(fx.out).toEqual([`clean: removed ${NAME}`, "clean: removed stale si.sock", "verdict: pass"]);
    expect(r.exit).toBe(0);
    expect(fs.existsSync(fx.lay.runDir)).toBe(false);
    expect(fs.existsSync(fx.siSock)).toBe(false);
  });

  it("CL-05 B live socket: kept, and it blocks the clean", async () => {
    const fx = fixture({ realSocket: true });
    const server = net.createServer();
    await new Promise<void>((res) => server.listen(fx.siSock, res));
    try {
      const before = snapshot(fx.real);
      const r = await fx.clean();
      expect(last(fx.out)).toBe(`${FAIL}si.sock live`);
      expect(r.exit).toBe(1);
      expect(fs.existsSync(fx.lay.runDir)).toBe(true);
      expect(snapshot(fx.real)).toEqual(before);
      expect(await probeSocket(fx.siSock)).toBe("live");
    } finally {
      await new Promise<void>((res) => server.close(() => res()));
    }
  });

  it.each([
    ["C", [OTHER_VERIFY] as number[] | "unknown", "[info] si.sock kept: verify binary running"],
    ["D", "unknown" as const, "[info] si.sock kept: process scan unknown"],
  ])("CL-05 %s stale socket kept when the scan is not []", async (_id, scan, info) => {
    const fx = fixture({ realSocket: true, procs: { scan } });
    await makeStaleSocket(fx.siSock);
    const r = await fx.clean();
    expect(fx.out).toEqual([`clean: removed ${NAME}`, info, "verdict: pass"]);
    expect(r.exit).toBe(0);
    expect(fs.existsSync(fx.lay.runDir)).toBe(false);
    expect(await probeSocket(fx.siSock)).toBe("stale");
  });
});

describe("WI-8 clean#run CL-09 a refused clean never touches a removable stale si.sock", () => {
  const rows: Row[] = [...CL02, CL03, ...CL07, ...CL08_REFUSE];
  it.each(rows.map((row) => [row.id, row] as const))("%s", async (_id, row) => {
    const fx = fixture({ ...row.opts, realSocket: true });
    await makeStaleSocket(fx.siSock);
    row.setup?.(fx);
    await expectRefused(fx, row);
    expect(await probeSocket(fx.siSock)).toBe("stale");
    expect(fs.existsSync(fx.siSock)).toBe(true);
    expect(fx.out.join("\n")).not.toContain("clean: removed stale si.sock");
  });
});

describe("WI-8 clean#run (additions) odd shapes, races and failure paths", () => {
  const DF = "verdict: driver failure — ";
  const bareDeps = (passwdHome: string, out: string[]) => ({
    passwdHome,
    uid: process.getuid?.(),
    siSockPath: "/tmp/lsi-none.sock",
    procFacts: fakeProcFacts(),
    out: (l: string) => out.push(l),
  });

  it("R is a regular file: refused on mode, launchJson and noLiveProcess; the file stays", async () => {
    const fx = fixture();
    fs.rmSync(fx.lay.runDir, { recursive: true });
    fs.writeFileSync(fx.lay.runDir, "not a dir");
    await expectRefused(fx, { id: "file", line: `${FAIL}ownership: mode, launchJson, noLiveProcess` });
    expect(fs.readFileSync(fx.lay.runDir, "utf8")).toBe("not a dir");
  });

  it("R is a dangling symlink: every fact it cannot prove refuses", async () => {
    const fx = fixture();
    fs.rmSync(fx.lay.runDir, { recursive: true });
    fs.symlinkSync("/tmp/lsi-no-such-target", fx.lay.runDir);
    const line = `${FAIL}ownership: realpathUnderParent, notSymlink, owner, mode, launchJson, noLiveProcess`;
    await expectRefused(fx, { id: "dangling", line });
    expect(fs.lstatSync(fx.lay.runDir).isSymbolicLink()).toBe(true);
  });

  it("launch.json symlinked to a valid body outside: refused on launchJson, the target untouched", async () => {
    const fx = fixture();
    const outside = outsideDir();
    fs.renameSync(fx.lay.launchJson, path.join(outside, "launch.json"));
    fs.symlinkSync(path.join(outside, "launch.json"), fx.lay.launchJson);
    fx.roots.push(outside);
    await expectRefused(fx, { id: "launch link", line: `${FAIL}ownership: launchJson` });
  });

  it("owner.json present but unparsable: a missing pid is never a dead pid", async () => {
    const fx = fixture();
    fs.writeFileSync(fx.lay.ownerJson, "{");
    await expectRefused(fx, { id: "owner corrupt", line: `${FAIL}ownership: noLiveProcess` });
  });

  it("no lock at all: R removed, no lock created", async () => {
    const fx = fixture();
    fs.unlinkSync(fx.lockPath);
    const r = await fx.clean();
    expect(fx.out).toEqual([`clean: removed ${NAME}`, "verdict: pass"]);
    expect(r.exit).toBe(0);
    expect(fs.existsSync(fx.lay.runDir)).toBe(false);
    expect(fs.existsSync(fx.lockPath)).toBe(false);
  });

  it("a lock naming R with another nonce: driver failure, R and the lock bytes kept", async () => {
    const fx = fixture();
    fs.unlinkSync(fx.lockPath);
    acquireLock(fx.parent, { run: NAME, nonce: "55".repeat(32) });
    const before = snapshot(fx.real);
    const r = await fx.clean();
    expect(last(fx.out)).toBe(`${DF}lock not released: lock for run ${NAME} holds another nonce`);
    expect(r.exit).toBe(1);
    expect(snapshot(fx.real)).toEqual(before);
  });

  it("R swapped for a symlink after the verdict: driver failure, link, target and lock kept", async () => {
    const outside = outsideDir();
    const fx = fixture({
      procs: {
        probe: async () => {
          fs.rmSync(fx.lay.runDir, { recursive: true });
          fs.symlinkSync(outside, fx.lay.runDir);
          return "absent";
        },
      },
    });
    const lock = fs.readFileSync(fx.lockPath, "utf8");
    const before = snapshot(outside);
    const r = await fx.clean();
    expect(last(fx.out)).toBe(`${DF}run dir changed during clean`);
    expect(r.exit).toBe(1);
    expect(fs.lstatSync(fx.lay.runDir).isSymbolicLink()).toBe(true);
    expect(snapshot(outside)).toEqual(before);
    expect(fs.readFileSync(fx.lockPath, "utf8")).toBe(lock);
  });

  it.skipIf(process.getuid?.() === 0)("rm fails inside R: driver failure naming the code, R still present", async () => {
    const fx = fixture();
    fs.chmodSync(fx.lay.drafts, 0o500);
    disposers.push(() => fs.chmodSync(fx.lay.drafts, 0o700));
    const r = await fx.clean();
    expect(last(fx.out)).toBe(`${DF}remove failed: EACCES`);
    expect(r.exit).toBe(1);
    expect(fs.existsSync(path.join(fx.lay.drafts, "d1.md"))).toBe(true);
  });

  it.skipIf(process.getuid?.() === 0)("CL-R10 rm fails inside R: the lock is kept byte-for-byte (delete before release)", async () => {
    const fx = fixture();
    const lock = fs.readFileSync(fx.lockPath, "utf8");
    fs.chmodSync(fx.lay.drafts, 0o500);
    disposers.push(() => fs.chmodSync(fx.lay.drafts, 0o700));
    const r = await fx.clean();
    expect(last(fx.out)).toBe(`${DF}remove failed: EACCES`);
    expect(r.exit).toBe(1);
    expect(fs.existsSync(fx.lockPath) ? fs.readFileSync(fx.lockPath, "utf8") : "lock released").toBe(lock);
  });

  it("CL-R11 the lock is retaken by another run while R is removed: R gone, driver failure, its lock kept", async () => {
    const fx = fixture();
    let other = "";
    fx.deps.rmSync = (p: string, o: fs.RmOptions) => {
      fs.rmSync(p, o);
      fs.unlinkSync(fx.lockPath);
      acquireLock(fx.parent, { run: OTHER, nonce: "44".repeat(32) });
      other = fs.readFileSync(fx.lockPath, "utf8");
    };
    const r = await fx.clean();
    expect(last(fx.out)).toBe(`${DF}removed ${NAME}, lock not released: lock names run ${OTHER}, not ${NAME}`);
    expect(r.exit).toBe(1);
    expect(fs.existsSync(fx.lay.runDir)).toBe(false);
    expect(fs.readFileSync(fx.lockPath, "utf8")).toBe(other);
  });

  it("the passwd home does not resolve: fail, exit 1", async () => {
    const out: string[] = [];
    const r: Result = await cleanRun({ run: NAME }, bareDeps("/tmp/lsi-no-such-home", out));
    expect(last(out)).toMatch(/^verdict: fail — ENOENT/);
    expect(r.exit).toBe(1);
  });

  it("the runs parent is a file: driver failure naming the code, nothing changed", async () => {
    const h = makeHome();
    disposers.push(h.cleanup);
    const parent: string = runsParent(h.real);
    fs.mkdirSync(path.dirname(parent), { recursive: true });
    fs.writeFileSync(parent, "x");
    const before = snapshot(h.real);
    const out: string[] = [];
    const r: Result = await cleanRun({ run: NAME }, bareDeps(h.home, out));
    expect(last(out)).toBe(`${DF}run dir unreadable: ENOTDIR`);
    expect(r.exit).toBe(1);
    expect(snapshot(h.real)).toEqual(before);
  });

  it("probe unknown: R removed, si.sock kept with an info line", async () => {
    const fx = fixture({ procs: { probe: "unknown" } });
    const r = await fx.clean();
    expect(fx.out).toEqual([`clean: removed ${NAME}`, "[info] si.sock kept: probe unknown", "verdict: pass"]);
    expect(r.exit).toBe(0);
  });

  it("probe stale but the path is a regular file: never unlinked", async () => {
    const fx = fixture({ procs: { probe: "stale" } });
    fs.writeFileSync(fx.siSock, "not a socket");
    const r = await fx.clean();
    expect(fx.out).toEqual([`clean: removed ${NAME}`, "[info] si.sock kept: not a socket", "verdict: pass"]);
    expect(r.exit).toBe(0);
    expect(fs.readFileSync(fx.siSock, "utf8")).toBe("not a socket");
  });

  it.skipIf(process.getuid?.() === 0)("a stale si.sock that cannot be unlinked: kept, info names the code", async () => {
    const fx = fixture({ realSocket: true });
    await makeStaleSocket(fx.siSock);
    fs.chmodSync(fx.sockDir, 0o500);
    disposers.push(() => fs.chmodSync(fx.sockDir, 0o700));
    const r = await fx.clean();
    expect(fx.out).toEqual([`clean: removed ${NAME}`, "[info] si.sock kept: unlink failed: EACCES", "verdict: pass"]);
    expect(r.exit).toBe(0);
    expect(await probeSocket(fx.siSock)).toBe("stale");
  });
});
