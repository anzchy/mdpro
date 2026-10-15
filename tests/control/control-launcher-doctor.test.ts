// @vitest-environment node
/**
 * ADR-0047 WI-003 WI-5: `doctor` — the pure checks (`doctorChecks.mjs`
 * `evaluate`) and the driver (`doctor.mjs` `run(args, deps)`).
 * Matrix: `.claude/tdd-guardian/tests-20261008-144444.md`, WI-5, DC-01..DC-06
 * and DD-01..DD-05; Round 3 (WI-R1) DR-R1. D2 is binding: a stale `.lock` blocks and names `clean`.
 *
 * Lines and next steps are pinned here as literals, never imported. The
 * driver runs on a real tmp fs and a real git repo (`GitSandbox`); only the
 * process facts (`deps.procFacts`) are faked, except the socket probe where
 * a case says real.
 */
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { GitSandbox } from "../helpers/controlGitRepo";
import { fakeProcFacts, makeHome, makeStaleSocket, type ProcFacts } from "../support/launcherFakes";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { evaluate } from "../../scripts/control/doctorChecks.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { run } from "../../scripts/control/doctor.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { runsParent } from "../../scripts/control/runDir.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { acquireLock } from "../../scripts/control/lock.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { probeSocket } from "../../scripts/control/procFacts.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { DEFAULT_EXCLUDES, computeSourceTree } from "../../scripts/control/sourceTree.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { buildLayout } from "../../scripts/control/buildSteps.mjs";

const SI = "/tmp/com_mdpro_app_verify_si.sock";
const R = "r".repeat(25);
const LABELS = [
  "bundle present",
  "manifest readable",
  "buildId known",
  "profile is verify",
  "sourceTree matches",
  "no run lock",
  "no verify binary running",
  "si.sock not live",
];
const OUTSIDE = [
  `[info] outside run dir: ${SI}`,
  "[info] outside run dir: WebKit and Caches (measured on macOS 26.3.1; macOS 13 unmeasured)",
  "[info] outside run dir: MCP client configs (4), not touched",
];
const NEXT_BUILD = "  next: pnpm control:build --profile verify";

type Facts = Record<string, unknown>;
const D = (): Facts => ({
  bundlePresent: true,
  manifest: { ok: true, buildId: "b1", profile: "verify" },
  sourceTreeMatches: true,
  lock: { state: "absent" },
  verifyPids: [],
  siSock: "absent",
  leftoverRuns: [],
  leftoverTmps: [],
});
type Result = { lines: string[]; exit: number };
const ev = (f: Facts): Result => evaluate(f);
const checkLines = (lines: string[]) => lines.filter((l) => /^\[(pass|FAIL|skip)\] /.test(l));
const failLines = (lines: string[]) => lines.filter((l) => l.startsWith("[FAIL] "));
const failLabels = (lines: string[]) =>
  failLines(lines).map((l) => (/^\[FAIL\] ([^:]+):/.exec(l) as RegExpExecArray)[1]);
const after = (lines: string[], line: string) => lines[lines.indexOf(line) + 1];

describe("WI-5 doctorChecks#evaluate (pure)", () => {
  it("DC-01 clean facts: 8 pass lines, the outside-state list, verdict pass", () => {
    const r = ev(D());
    expect(r.lines).toEqual([...LABELS.map((l) => `[pass] ${l}`), ...OUTSIDE, "verdict: pass"]);
    expect(r.exit).toBe(0);
  });

  const SKIPPED = ["buildId known", "profile is verify", "sourceTree matches"];
  const ROWS: { name: string; patch: (f: Facts) => void; label: string; fail: string; next: string }[] = [
    {
      name: "bundle absent",
      patch: (f) => (f.bundlePresent = false),
      label: "bundle present",
      fail: "[FAIL] bundle present: missing ./src-tauri/target/verify/release/bundle/macos/mdpro-verify.app",
      next: NEXT_BUILD,
    },
    {
      name: "manifest missing",
      patch: (f) => (f.manifest = { ok: false, why: "missing" }),
      label: "manifest readable",
      fail: "[FAIL] manifest readable: missing",
      next: NEXT_BUILD,
    },
    {
      name: "manifest not JSON",
      patch: (f) => (f.manifest = { ok: false, why: "not valid JSON" }),
      label: "manifest readable",
      fail: "[FAIL] manifest readable: not valid JSON",
      next: NEXT_BUILD,
    },
    {
      name: "buildId unknown",
      patch: (f) => (f.manifest = { ok: true, buildId: "unknown", profile: "verify" }),
      label: "buildId known",
      fail: '[FAIL] buildId known: buildId is "unknown"',
      next: NEXT_BUILD,
    },
    {
      name: "profile release",
      patch: (f) => (f.manifest = { ok: true, buildId: "b1", profile: "release" }),
      label: "profile is verify",
      fail: '[FAIL] profile is verify: profile is "release"',
      next: NEXT_BUILD,
    },
    {
      name: "sourceTree differs",
      patch: (f) => (f.sourceTreeMatches = false),
      label: "sourceTree matches",
      fail: "[FAIL] sourceTree matches: tree differs from the manifest",
      next: NEXT_BUILD,
    },
    {
      name: "live lock",
      patch: (f) => (f.lock = { state: "held", run: R, live: true }),
      label: "no run lock",
      fail: `[FAIL] no run lock: lock held by run ${R} (live)`,
      next: `  next: pnpm control:quit ${R}`,
    },
    {
      name: "verify pid running",
      patch: (f) => (f.verifyPids = [4242]),
      label: "no verify binary running",
      fail: "[FAIL] no verify binary running: pid 4242 running",
      next: "  next: pnpm control:quit",
    },
    {
      name: "si.sock live",
      patch: (f) => (f.siSock = "live"),
      label: "si.sock not live",
      fail: `[FAIL] si.sock not live: live listener at ${SI}`,
      next: "  next: pnpm control:quit",
    },
  ];

  it.each(ROWS)("DC-02 single blocking fault: $name", ({ patch, label, fail, next }) => {
    const f = D();
    patch(f);
    const r = ev(f);
    const manifestRow = label === "manifest readable";
    expect(failLines(r.lines)).toEqual([fail]);
    expect(after(r.lines, fail)).toBe(next);
    expect(checkLines(r.lines)).toEqual(
      LABELS.map((l) => {
        if (l === label) return fail;
        if (manifestRow && SKIPPED.includes(l)) return `[skip] ${l}: manifest unavailable`;
        return `[pass] ${l}`;
      }),
    );
    expect(r.lines.at(-1)).toBe(label === "sourceTree matches" ? "verdict: NOT VERIFIED" : "verdict: fail");
    expect(r.exit).toBe(1);
  });

  it("DC-03 a stale lock blocks and names clean (D2); a corrupt lock blocks", () => {
    const stale = ev({ ...D(), lock: { state: "held", run: R, live: false } });
    const line = `[FAIL] no run lock: stale lock names run ${R}`;
    expect(failLines(stale.lines)).toEqual([line]);
    expect(after(stale.lines, line)).toBe(`  next: pnpm control:clean ${R}`);
    expect(stale.lines.at(-1)).toBe("verdict: fail");
    expect(stale.exit).toBe(1);

    const corrupt = ev({ ...D(), lock: { state: "corrupt" } });
    const cline = "[FAIL] no run lock: lock unreadable";
    expect(failLines(corrupt.lines)).toEqual([cline]);
    expect(after(corrupt.lines, cline)).toBe(
      "  next: inspect ~/Library/Application Support/mdpro-verify/runs/.lock by hand",
    );
    expect(corrupt.lines.at(-1)).toBe("verdict: fail");
    expect(corrupt.exit).toBe(1);
  });

  it("DC-04 unknown facts block", () => {
    const pids = ev({ ...D(), verifyPids: "unknown" });
    expect(failLines(pids.lines)).toEqual(["[FAIL] no verify binary running: process scan unknown"]);
    expect(pids.exit).toBe(1);
    const sock = ev({ ...D(), siSock: "unknown" });
    expect(failLines(sock.lines)).toEqual(["[FAIL] si.sock not live: probe unknown"]);
    expect(sock.exit).toBe(1);
  });

  it("DC-05 conjunction and verdict over all 2^7 fault masks", () => {
    const FAULTS: [string, (f: Facts) => void][] = [
      ["bundle present", (f) => (f.bundlePresent = false)],
      ["buildId known", (f) => ((f.manifest as Facts).buildId = "unknown")],
      ["profile is verify", (f) => ((f.manifest as Facts).profile = "release")],
      ["sourceTree matches", (f) => (f.sourceTreeMatches = false)],
      ["no run lock", (f) => (f.lock = { state: "held", run: R, live: true })],
      ["no verify binary running", (f) => (f.verifyPids = [4242])],
      ["si.sock not live", (f) => (f.siSock = "live")],
    ];
    for (let mask = 0; mask < 1 << FAULTS.length; mask++) {
      const f = D();
      const want: string[] = [];
      FAULTS.forEach(([label, apply], bit) => {
        if (mask & (1 << bit)) {
          apply(f);
          want.push(label);
        }
      });
      const r = ev(f);
      expect(r.exit, `mask ${mask}`).toBe(mask ? 1 : 0);
      expect(new Set(failLabels(r.lines)), `mask ${mask}`).toEqual(new Set(want));
      const verdict = mask & (1 << 3) ? "verdict: NOT VERIFIED" : mask ? "verdict: fail" : "verdict: pass";
      expect(r.lines.at(-1), `mask ${mask}`).toBe(verdict);
    }
  });

  it.each([
    ["lock absent", { state: "absent" }, "(pnpm control:clean 0000000000000000000000000 removes it; any absent run name works)"],
    ["stale lock", { state: "held", run: R, live: false }, `(pnpm control:clean ${R} removes it)`],
    ["corrupt lock", { state: "corrupt" }, "(fix the lock first, then pnpm control:clean 0000000000000000000000000 removes it)"],
    ["no lock fact", undefined, "(fix the lock first, then pnpm control:clean 0000000000000000000000000 removes it)"],
  ])("DR-R1 no run dirs and a stale si.sock, %s: the hint names a command clean handles", (_id, lock, hint) => {
    const r = ev({ ...D(), lock, siSock: "stale", leftoverRuns: [] });
    expect(r.lines.filter((l) => l.startsWith("[info] stale si.sock"))).toEqual([`[info] stale si.sock ${SI} ${hint}`]);
  });

  it("DC-06 informational lines name the run and never block", () => {
    const R1 = "1".repeat(25);
    const R2 = "2".repeat(25);
    const tmp = ".instance.json.3f2a9c1e-0000-4000-8000-000000000001.tmp";
    const r = ev({ ...D(), leftoverRuns: [R1, R2], leftoverTmps: [{ run: R1, file: tmp }], siSock: "stale" });
    expect(r.lines).toEqual(
      expect.arrayContaining([
        `[info] leftover run ${R1}`,
        `[info] leftover run ${R2}`,
        `[info] leftover tmp ${R1}/${tmp}`,
        `[info] stale si.sock ${SI} (pnpm control:clean <run> removes it)`,
        "[pass] si.sock not live",
      ]),
    );
    expect(r.lines.at(-1)).toBe("verdict: pass");
    expect(r.exit).toBe(0);
  });
});

// ---------------------------------------------------------------- driver

type Snap = { rel: string; mode: number; mtimeMs: number; size: number }[];
function snapshot(root: string): Snap {
  const out: Snap = [];
  const walk = (p: string) => {
    const st = fs.lstatSync(p);
    out.push({ rel: path.relative(root, p), mode: st.mode, mtimeMs: st.mtimeMs, size: st.size });
    if (st.isDirectory()) for (const e of fs.readdirSync(p)) walk(path.join(p, e));
  };
  if (fs.existsSync(root)) walk(root);
  return out.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
}

let sb: GitSandbox;
let baseRepo: string;

/** A repo whose verify bundle and manifest match its current source tree. */
async function mkVerifyRepo(name: string): Promise<string> {
  const repo = sb.mkRepo(name);
  sb.write(repo, ".gitignore", "dist/\nsrc-tauri/target/\n");
  sb.commitAll(repo, "ignore target");
  const lay = buildLayout(repo, "verify");
  fs.mkdirSync(lay.app, { recursive: true });
  const { tree } = await computeSourceTree(repo, { excludes: DEFAULT_EXCLUDES });
  const manifest = { profile: "verify", buildId: "b1", sourceTree: tree, sourceTreeExcludes: [...DEFAULT_EXCLUDES] };
  fs.writeFileSync(lay.manifestPath, JSON.stringify(manifest));
  return repo;
}

const homes: { cleanup: () => void }[] = [];
const extraDirs: string[] = [];
function home() {
  const h = makeHome();
  homes.push(h);
  return h;
}
function sockDir(): string {
  const d = fs.mkdtempSync("/tmp/s");
  extraDirs.push(d);
  return d;
}

async function doctor(
  repoRoot: string,
  passwdHome: string,
  procFacts: ProcFacts = fakeProcFacts(),
  siSockPath = path.join(sockDir(), "si.sock"),
): Promise<Result> {
  const lines: string[] = [];
  const res = await run([], { repoRoot, passwdHome, siSockPath, procFacts, out: (l: string) => lines.push(l) });
  return { lines, exit: res.exit };
}

const NONCE = "ab".repeat(32);
const TMP = ".instance.json.3f2a9c1e-0000-4000-8000-000000000001.tmp";
const R1 = "1".repeat(25);
const R2 = "2".repeat(25);

/** R1 (launch.json, instance.json, owner.json pid 5151, a tmp leftover), R2 empty, `.lock` naming R1. */
function seedRuns(parent: string): void {
  const r1 = path.join(parent, R1);
  fs.mkdirSync(r1, { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.join(parent, R2), { mode: 0o700 });
  fs.writeFileSync(path.join(r1, "launch.json"), JSON.stringify({ nonce: NONCE, buildId: "b1", mainBinary: "/A/tauri-app" }));
  fs.writeFileSync(path.join(r1, "instance.json"), JSON.stringify({ nonce: NONCE, pid: 5151, buildId: "b1" }));
  fs.writeFileSync(
    path.join(r1, "owner.json"),
    JSON.stringify({ pid: 5151, startTime: "Thu Oct  8 14:44:44 2026", exeRealpath: "/A/tauri-app" }),
  );
  fs.writeFileSync(path.join(r1, TMP), "{");
  acquireLock(parent, { run: R1, nonce: NONCE });
}

describe("WI-5 doctor#run (driver)", { timeout: 60_000 }, () => {
  beforeAll(async () => {
    sb = new GitSandbox();
    sb.stubEnv();
    baseRepo = await mkVerifyRepo("base");
  });
  afterAll(() => {
    vi.unstubAllEnvs();
    sb.cleanup();
  });
  afterEach(() => {
    for (const h of homes.splice(0)) h.cleanup();
    for (const d of extraDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  it("DD-01 manifest and bundle variants collected from a real tree", async () => {
    const { home: h } = home();
    const a = await doctor(baseRepo, h);
    expect(a.lines.at(-1)).toBe("verdict: pass");
    expect(a.exit).toBe(0);

    const b = sb.copy(baseRepo, "dd01b");
    fs.rmSync(buildLayout(b, "verify").manifestPath);
    const rb = await doctor(b, h);
    expect(failLines(rb.lines)).toEqual(["[FAIL] manifest readable: missing"]);
    expect(rb.exit).toBe(1);

    const c = sb.copy(baseRepo, "dd01c");
    fs.writeFileSync(buildLayout(c, "verify").manifestPath, "{");
    const rc = await doctor(c, h);
    expect(failLines(rc.lines)).toEqual(["[FAIL] manifest readable: not valid JSON"]);
    expect(rc.exit).toBe(1);

    const d = sb.copy(baseRepo, "dd01d");
    fs.rmSync(buildLayout(d, "verify").app, { recursive: true });
    const rd = await doctor(d, h);
    expect(failLines(rd.lines)).toEqual([
      "[FAIL] bundle present: missing ./src-tauri/target/verify/release/bundle/macos/mdpro-verify.app",
    ]);
    expect(rd.exit).toBe(1);
  });

  it("DD-02 lock and run dirs collected from the real runs parent (stale lock blocks, D2)", async () => {
    const { home: h, real } = home();
    seedRuns(runsParent(real));
    const pf = fakeProcFacts({ pids: { 5151: { alive: false } } });
    const r = await doctor(baseRepo, h, pf);
    expect(r.lines).toEqual(
      expect.arrayContaining([`[info] leftover run ${R1}`, `[info] leftover run ${R2}`, `[info] leftover tmp ${R1}/${TMP}`]),
    );
    expect(r.lines.filter((l) => l.startsWith("[info] leftover run "))).toHaveLength(2);
    const line = `[FAIL] no run lock: stale lock names run ${R1}`;
    expect(failLines(r.lines)).toEqual([line]);
    expect(after(r.lines, line)).toBe(`  next: pnpm control:clean ${R1}`);
    expect(r.lines.at(-1)).toBe("verdict: fail");
    expect(r.exit).toBe(1);
  });

  it("DD-03 Trap 2: an edited tracked file fails sourceTree, an excluded edit does not (real git)", async () => {
    const repo = await mkVerifyRepo("trap2");
    const { home: h } = home();
    const r1 = await doctor(repo, h);
    expect(r1.lines).toContain("[pass] sourceTree matches");
    expect(r1.exit).toBe(0);

    sb.write(repo, "docs/x.md", "y");
    const r2 = await doctor(repo, h);
    expect(r2.lines).toContain("[pass] sourceTree matches");
    expect(r2.exit).toBe(0);

    sb.write(repo, "src/a.ts", "edited");
    const r3 = await doctor(repo, h);
    expect(failLines(r3.lines)).toEqual(["[FAIL] sourceTree matches: tree differs from the manifest"]);
    expect(r3.lines.at(-1)).toBe("verdict: NOT VERIFIED");
    expect(r3.exit).toBe(1);
  });

  it("DD-04 doctor mutates nothing: parent and si.sock dir identical across two runs", async () => {
    const { home: h, real } = home();
    const parent = runsParent(real);
    seedRuns(parent);
    const sdir = sockDir();
    const sock = path.join(sdir, "si.sock");
    await makeStaleSocket(sock);
    const pf = fakeProcFacts({ pids: { 5151: { alive: false } }, probe: (p) => probeSocket(p) });

    const before = [snapshot(parent), snapshot(sdir)];
    const r1 = await doctor(baseRepo, h, pf, sock);
    const r2 = await doctor(baseRepo, h, pf, sock);
    expect([snapshot(parent), snapshot(sdir)]).toEqual(before);
    expect(fs.existsSync(sock)).toBe(true);
    expect(r1.lines).toContain(`[info] stale si.sock ${sock} (pnpm control:clean <run> removes it)`);
    expect(r2.lines).toEqual(r1.lines);
  });

  it("DD-05 a missing runs parent: no leftovers, no lock, nothing created", async () => {
    const { home: h, real } = home();
    const before = snapshot(real);
    const r = await doctor(baseRepo, h);
    expect(r.lines.filter((l) => l.startsWith("[info] leftover"))).toEqual([]);
    expect(r.lines).toContain("[pass] no run lock");
    expect(fs.existsSync(path.join(h, "Library"))).toBe(false);
    expect(snapshot(real)).toEqual(before);
  });

  // Additions beyond the matrix rows (acceptance: live lock, live si.sock, no nonce text).
  it("DD-06 a live owned lock blocks with quit, and no nonce or digest text is printed", async () => {
    const { home: h, real } = home();
    seedRuns(runsParent(real));
    const lockText = fs.readFileSync(path.join(runsParent(real), ".lock"), "utf8");
    const pf = fakeProcFacts({
      pids: { 5151: { alive: true, lstart: "Thu Oct  8 14:44:44 2026", exe: "/A/tauri-app" } },
    });
    const r = await doctor(baseRepo, h, pf);
    const line = `[FAIL] no run lock: lock held by run ${R1} (live)`;
    expect(failLines(r.lines)).toEqual([line]);
    expect(after(r.lines, line)).toBe(`  next: pnpm control:quit ${R1}`);
    const text = r.lines.join("\n");
    expect(text).not.toContain(NONCE);
    expect(text).not.toContain(JSON.parse(lockText).nonceDigest);
    expect(r.exit).toBe(1);
  });

  it("DD-07 a live si.sock listener (real socket) blocks", async () => {
    const { home: h } = home();
    const sock = path.join(sockDir(), "si.sock");
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(sock, resolve));
    try {
      const r = await doctor(baseRepo, h, fakeProcFacts({ probe: (p) => probeSocket(p) }), sock);
      expect(failLines(r.lines)).toEqual([`[FAIL] si.sock not live: live listener at ${sock}`]);
      expect(r.exit).toBe(1);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
