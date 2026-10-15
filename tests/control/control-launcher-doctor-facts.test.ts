// @vitest-environment node
/**
 * ADR-0047 WI-003 review fix WI-R2: characterization of `doctor`'s real
 * fact collection on paths no earlier case reached (the WI-9 91% per-file
 * branch floor): an unreadable or non-object manifest, a tree that cannot be
 * compared, a lock naming a non-run, odd entries in the runs parent, and a
 * home that does not resolve. None was red; written after the WI-R2 red
 * record. Every case pins doctor's printed lines and exit code.
 * Matrix: `.claude/tdd-guardian/tests-20261008-144444.md`, "Round 4 changes
 * (review fixes, WI-R2)", DF-R1..DF-R5.
 *
 * The repo root is a plain tmp dir (not a git worktree) holding the verify
 * bundle layout; the home is `makeHome()`. Only `deps.procFacts` is faked.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fakeProcFacts, makeHome } from "../support/launcherFakes";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { run } from "../../scripts/control/doctor.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { buildLayout } from "../../scripts/control/buildSteps.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { runsParent } from "../../scripts/control/runDir.mjs";

type Result = { exit: number; lines: string[] };
const R1 = "1".repeat(25);
const R2 = "2".repeat(25);

let disposers: (() => void)[] = [];
afterEach(() => {
  for (const d of disposers.reverse()) d();
  disposers = [];
});

/** A non-git repo root with the verify bundle dir and, unless `manifest` is undefined, a manifest. */
function repo(manifest?: (file: string) => void): string {
  const root = fs.realpathSync(fs.mkdtempSync("/tmp/dfr-"));
  disposers.push(() => fs.rmSync(root, { recursive: true, force: true }));
  const lay = buildLayout(root, "verify");
  fs.mkdirSync(lay.app, { recursive: true });
  if (manifest) manifest(lay.manifestPath);
  return root;
}

function home() {
  const h = makeHome();
  disposers.push(h.cleanup);
  return h;
}

async function doctor(repoRoot: string, passwdHome: string): Promise<Result & { out: string[] }> {
  const out: string[] = [];
  const r: Result = await run([], {
    repoRoot,
    passwdHome,
    siSockPath: `/tmp/dfr-${process.pid}-absent.sock`,
    procFacts: fakeProcFacts(),
    out: (l: string) => out.push(l),
  });
  return { ...r, out };
}

const withPrefix = (lines: string[], p: string) => lines.filter((l) => l.startsWith(p));

describe("WI-R2 doctor: manifest and source tree facts", () => {
  const MANIFESTS: { row: string; write: (f: string) => void; line: string }[] = [
    { row: "a directory", write: (f) => fs.mkdirSync(f), line: "[FAIL] manifest readable: unreadable" },
    { row: "[]", write: (f) => fs.writeFileSync(f, "[]"), line: "[FAIL] manifest readable: not a JSON object" },
    { row: "null", write: (f) => fs.writeFileSync(f, "null"), line: "[FAIL] manifest readable: not a JSON object" },
  ];
  it.each(MANIFESTS)("DF-R1 manifest is $row: one manifest failure, exit 1", async ({ write, line }) => {
    const r = await doctor(repo(write), home().home);
    expect(withPrefix(r.out, "[FAIL] manifest readable")).toEqual([line]);
    expect(r.exit).toBe(1);
  });

  const TREES: { row: string; body: Record<string, unknown> }[] = [
    { row: "no sourceTree", body: { profile: "verify", buildId: "b1", sourceTreeExcludes: [] } },
    { row: "not a git worktree", body: { profile: "verify", buildId: "b1", sourceTree: "a".repeat(40), sourceTreeExcludes: [] } },
  ];
  it.each(TREES)("DF-R2 $row: source tree unknown, verdict NOT VERIFIED", async ({ body }) => {
    const r = await doctor(repo((f) => fs.writeFileSync(f, JSON.stringify(body))), home().home);
    expect(withPrefix(r.out, "[FAIL] ")).toEqual(["[FAIL] sourceTree matches: source tree unknown"]);
    expect(r.out.at(-1)).toBe("verdict: NOT VERIFIED");
    expect(r.exit).toBe(1);
  });
});

describe("WI-R2 doctor: runs parent facts", () => {
  it("DF-R3 a lock naming ../x with a valid digest reads as unreadable; its bytes stay", async () => {
    const h = home();
    const parent: string = runsParent(h.real);
    fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
    const lockPath = path.join(parent, ".lock");
    const body = JSON.stringify({ run: "../x", nonceDigest: "a".repeat(64) });
    fs.writeFileSync(lockPath, body, { mode: 0o600 });
    const r = await doctor(repo(), h.home);
    expect(withPrefix(r.out, "[FAIL] no run lock")).toEqual(["[FAIL] no run lock: lock unreadable"]);
    expect(r.exit).toBe(1);
    expect(fs.readFileSync(lockPath, "utf8")).toBe(body);
  });

  it.skipIf(process.getuid?.() === 0)(
    "DF-R4 a regular file named like a run and an unreadable run dir: only the dir is a leftover, no tmp lines",
    async () => {
      const h = home();
      const parent: string = runsParent(h.real);
      fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
      const base = await doctor(repo(), h.home);
      fs.writeFileSync(path.join(parent, R1), "x");
      fs.mkdirSync(path.join(parent, R2), { mode: 0o700 });
      fs.writeFileSync(path.join(parent, R2, ".instance.json.x.tmp"), "{");
      fs.chmodSync(path.join(parent, R2), 0o000);
      disposers.push(() => fs.chmodSync(path.join(parent, R2), 0o700));
      const r = await doctor(repo(), h.home);
      expect(withPrefix(r.out, "[info] leftover")).toEqual([`[info] leftover run ${R2}`]);
      expect({ verdict: r.out.at(-1), exit: r.exit }).toEqual({ verdict: base.out.at(-1), exit: base.exit });
    },
  );

  it("DF-R5 the passwd home does not resolve: one driver-failure line naming ENOENT", async () => {
    const dir = fs.mkdtempSync("/tmp/dfr-");
    disposers.push(() => fs.rmSync(dir, { recursive: true, force: true }));
    const r = await doctor(repo(), path.join(dir, "missing"));
    expect(r.out).toEqual(["verdict: driver failure — facts unavailable (ENOENT)"]);
    expect(r.exit).toBe(1);
    expect(fs.readdirSync(dir)).toEqual([]);
  });
});
