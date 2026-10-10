// @vitest-environment node
/**
 * D82-WI-4 (M3, L1): the option parser `split()` in `launcherCli.mjs`.
 * Matrix: `.claude/tdd-guardian/tests-20261010-103136.md`, "D82-WI-4"
 * (CLI-M3-1, CLI-M3-2, CLI-L1-1, CLI-P).
 *
 * M3: a flag never takes another option token as its value; `<flag> needs a
 * value` instead. L1: `Object.prototype` keys are plain positionals, not flags.
 * Kept out of `control-launcher-cli.test.ts` so its recorded assertions stay
 * byte-identical.
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import * as cli from "../scripts/control/launcherCli.mjs";
import { int, mulberry32, pick, str } from "./support/seededRandom";

type Parse = (argv: string[]) => Record<string, unknown>;
const L = cli.parseLaunchArgs as Parse;
const Q = cli.parseQuitArgs as Parse;
const C = cli.parseCleanArgs as Parse;
const D = cli.parseDoctorArgs as Parse;
const R = "R";
const FLAGS = ["--into", "--via", "--view-mode"] as const;
const OPTION_LIKE = ["--into", "--via", "--view-mode", "-x", "--", "-"] as const;
const PROTO_KEYS = ["toString", "constructor", "hasOwnProperty", "__proto__", "valueOf"] as const;

/** The thrown error's `{ name, reason }`, or the returned value when nothing throws. */
const outcome = (fn: Parse, argv: string[]): { name: string; reason: unknown } | { value: unknown } => {
  try {
    return { value: fn(argv) };
  } catch (e) {
    const err = e as { name?: unknown; reason?: unknown };
    return { name: String(err.name), reason: err.reason };
  }
};

describe("D82-WI-4 CLI-M3-1 a flag followed by an option-looking token", () => {
  const rows = FLAGS.flatMap((flag) =>
    OPTION_LIKE.flatMap((next) => [
      { argv: [flag, next, R], flag },
      { argv: [flag, next], flag },
    ]),
  );

  it.each(rows)("parseLaunchArgs($argv) → `$flag needs a value`", ({ argv, flag }) => {
    expect(outcome(L, argv)).toEqual({ name: "UsageError", reason: `${flag} needs a value` });
  });

  it("the audit's example no longer swallows --into as the view mode", () => {
    expect(outcome(L, ["--view-mode", "--into", R])).toEqual({ name: "UsageError", reason: "--view-mode needs a value" });
  });
});

describe("D82-WI-4 CLI-M3-2 through main", () => {
  it("--view-mode --into R: exit 2, reason on stderr, usage line last, run never called", async () => {
    const out: string[] = [];
    const err: string[] = [];
    let calls = 0;
    const io = {
      run: async () => ((calls += 1), { exit: 0 }),
      out: (l: string) => out.push(l),
      err: (l: string) => err.push(l),
      repoRoot: "/Users/u/r",
      homeDir: "/Users/u",
    };
    expect(await cli.main("launch", ["--view-mode", "--into", R], io)).toBe(2);
    expect(err).toEqual(["launch: --view-mode needs a value"]);
    expect(out.at(-1)).toBe(
      "usage: pnpm control:launch [--into <run>] [--via open] [--view-mode source|wysiwyg] [<file>]",
    );
    expect(calls).toBe(0);
  });
});

describe("D82-WI-4 CLI-L1-1 prototype keys are plain positionals", () => {
  it.each(PROTO_KEYS)("%s", (t) => {
    expect(outcome(L, [t])).toStrictEqual({ value: { file: t } });
    expect(outcome(Q, [t])).toStrictEqual({ value: { run: t } });
    expect(outcome(C, [t])).toStrictEqual({ value: { run: t } });
    expect(outcome(D, [t])).toEqual({ name: "UsageError", reason: "takes no arguments" });
  });

  it("__proto__ lands as an own key, not as the prototype", () => {
    const l = outcome(L, ["__proto__"]) as { value?: object };
    const q = outcome(Q, ["__proto__"]) as { value?: object };
    const c = outcome(C, ["__proto__"]) as { value?: object };
    expect(l.value && Object.keys(l.value)).toEqual(["file"]);
    expect(q.value && Object.keys(q.value)).toEqual(["run"]);
    expect(c.value && Object.keys(c.value)).toEqual(["run"]);
  });
});

describe("D82-WI-4 CLI-P seeded parser property (mulberry32(2026101002))", () => {
  const SEED = 2026101002;
  const CASES = 500;
  const POOL = [...FLAGS, "-x", "--", "-", "--bogus", ...PROTO_KEYS, "open", "source", "wysiwyg"];
  const PARSERS: Array<[string, Parse, readonly string[]]> = [
    ["launch", L, ["into", "via", "viewMode", "file"]],
    ["quit", Q, ["run"]],
    ["clean", C, ["run"]],
  ];
  const isOption = (t: string) => t.startsWith("-");

  it("a parse throws UsageError or yields only declared keys whose values are non-option argv tokens", () => {
    const r = mulberry32(SEED);
    const violations: string[] = [];
    for (let n = 0; n < CASES; n++) {
      const argv = Array.from({ length: int(r, 0, 6) }, () =>
        r() < 0.75 ? pick(r, POOL) : str(r, "abcdefghijklmnopqrstuvwxyz0123456789/.", 1, 8),
      );
      for (const [verb, parse, keys] of PARSERS) {
        const got = outcome(parse, argv);
        const tag = `${verb}(${JSON.stringify(argv)})`;
        if ("value" in got) {
          const v = got.value as Record<string, unknown>;
          for (const k of Object.keys(v)) if (!keys.includes(k)) violations.push(`${tag}: undeclared key ${k}`);
          if (Object.getPrototypeOf(v) !== Object.prototype) violations.push(`${tag}: prototype replaced`);
          for (const val of Object.values(v)) {
            if (typeof val !== "string") violations.push(`${tag}: non-string value ${String(val)}`);
            else if (isOption(val)) violations.push(`${tag}: option token ${val} taken as a value`);
            else if (!argv.includes(val)) violations.push(`${tag}: value ${val} not in argv`);
          }
        } else if (got.name !== "UsageError" || typeof got.reason !== "string" || got.reason === "") {
          violations.push(`${tag}: threw ${got.name} (${String(got.reason)})`);
        }
        if (argv[0] !== "--") {
          const prefixed = outcome(parse, ["--", ...argv]);
          if (JSON.stringify(prefixed) !== JSON.stringify(got)) violations.push(`${tag}: '--' prefix changed the outcome`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
