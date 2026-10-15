// @vitest-environment node
/**
 * ADR-0047 WI-003 review fix WI-R2: `launch` with a passwd home that cannot
 * be resolved prints one driver-failure verdict naming the error code, exits
 * 1, and creates nothing (no runs parent, no lock, no run dir, no random
 * draw, no spawn).
 * Matrix: `.claude/tdd-guardian/tests-20261008-144444.md`, "Round 4 changes
 * (review fixes, WI-R2)", LH-R1.
 *
 * The doctor gate is the fixture's all-pass `collectDoctorFacts`, so the
 * home is first resolved by `launch` itself. A thrown `run` is turned into a
 * result here so a red run reports an assertion, not the raw fs error.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { last, launchFixture, walk, type Fixture } from "../support/launchHarness";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { run } from "../../scripts/control/launch.mjs";

type Result = { exit: number | string; lines: string[] };

let cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

const settle = (p: Promise<Result>): Promise<Result> =>
  p.then(
    (r) => r,
    (e: unknown) => ({ exit: "threw", lines: [`threw ${(e as { code?: string })?.code ?? "?"}`] }),
  );

/** Every entry under `root` (never through a link) with its type and mode. */
const shape = (root: string) =>
  walk(root).map((rel) => {
    const st = fs.lstatSync(path.join(root, rel));
    return { rel, mode: st.mode, link: st.isSymbolicLink() };
  });

const ROWS: { code: string; make: (dir: string) => string }[] = [
  { code: "ENOENT", make: (dir) => path.join(dir, "missing", "h") },
  {
    code: "ENOTDIR",
    make: (dir) => {
      fs.writeFileSync(path.join(dir, "file"), "x");
      return path.join(dir, "file", "h");
    },
  },
  {
    code: "ELOOP",
    make: (dir) => {
      fs.symlinkSync("loop", path.join(dir, "loop"));
      return path.join(dir, "loop");
    },
  },
];

describe("WI-R2 launch: an unresolvable passwd home", () => {
  it.each(ROWS)("LH-R1 home $code: driver failure naming the code, nothing created", async ({ code, make }) => {
    const fx: Fixture = launchFixture();
    cleanups.push(fx.cleanup);
    const dir = fs.mkdtempSync("/tmp/lh-");
    cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
    fx.deps.passwdHome = make(dir);
    const before = { dir: shape(dir), real: shape(fx.real) };
    const r = await settle(run({ file: "/tmp/f.md" }, fx.deps));
    expect({ last: last(fx.out) ?? r.lines[0], exit: r.exit }).toEqual({
      last: `verdict: driver failure — home unresolvable: ${code}`,
      exit: 1,
    });
    expect({ dir: shape(dir), real: shape(fx.real) }).toEqual(before);
    expect(fx.rng.draws()).toBe(0);
    expect(fx.spawn.calls).toHaveLength(0);
  });
});
