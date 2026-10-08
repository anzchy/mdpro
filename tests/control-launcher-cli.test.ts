// @vitest-environment node
/**
 * ADR-0047 WI-003 WI-9: the CLI shims and package scripts.
 * Matrix: `.claude/tdd-guardian/tests-20261008-144444.md`, RX-07 ("Unit: CLI
 * shims and package scripts").
 *
 * The argv parsers are pure lookups; a usage error is thrown before any I/O.
 * One real `node scripts/control/launch.mjs --via bogus` run proves the
 * `pathToFileURL` shim exists and maps a usage error to exit 2 with the usage
 * line last on stdout, under an empty HOME, TMPDIR and cwd that stay empty.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import * as launch from "../scripts/control/launch.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import * as quit from "../scripts/control/quit.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import * as clean from "../scripts/control/clean.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import * as doctor from "../scripts/control/doctor.mjs";

const REPO = path.resolve(__dirname, "..");
const R = "r".repeat(25);
type Parse = (argv: string[]) => Record<string, unknown>;

let dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  dirs = [];
});
const tmp = (prefix: string) => {
  const d = fs.mkdtempSync(prefix);
  dirs.push(d);
  return d;
};

describe("WI-9 RX-07 argv parsers", () => {
  it("each driver exports its parser", () => {
    expect(launch.parseLaunchArgs).toBeTypeOf("function");
    expect(quit.parseQuitArgs).toBeTypeOf("function");
    expect(clean.parseCleanArgs).toBeTypeOf("function");
    expect(doctor.parseDoctorArgs).toBeTypeOf("function");
  });

  it("parseLaunchArgs: --into, --via open and a file", () => {
    expect(launch.parseLaunchArgs).toBeTypeOf("function");
    const p = launch.parseLaunchArgs as Parse;
    expect(p(["--into", R, "--via", "open", "/f.md"])).toEqual({ into: R, via: "open", file: "/f.md" });
  });

  it.each([[["--via", "bogus"]], [["--into"]], [["--frobnicate"]]])("parseLaunchArgs(%j) throws usage", (argv) => {
    expect(launch.parseLaunchArgs).toBeTypeOf("function");
    expect(() => (launch.parseLaunchArgs as Parse)(argv)).toThrow(/^usage: /);
  });

  it("parsers: the rest of the table", () => {
    for (const fn of [launch.parseLaunchArgs, quit.parseQuitArgs, clean.parseCleanArgs, doctor.parseDoctorArgs]) {
      expect(fn).toBeTypeOf("function");
    }
    const L = launch.parseLaunchArgs as Parse;
    expect(L(["--", "/f.md"])).toEqual({ file: "/f.md" });
    expect(L([])).toEqual({});
    expect(L(["--view-mode", "source", "/f.md"])).toEqual({ viewMode: "source", file: "/f.md" });
    expect(() => L(["/a.md", "/b.md"])).toThrow(/^usage: /);
    expect(() => L(["--view-mode"])).toThrow(/^usage: /);
    expect(() => L(["--via"])).toThrow(/^usage: /);
    const Q = quit.parseQuitArgs as Parse;
    expect(Q([])).toEqual({});
    expect(Q(["--", R])).toEqual({ run: R });
    expect(() => Q([R, R])).toThrow(/^usage: /);
    expect(() => Q(["--force"])).toThrow(/^usage: /);
    const C = clean.parseCleanArgs as Parse;
    expect(C([R])).toEqual({ run: R });
    expect(() => C([])).toThrow(/^usage: /);
    expect(() => C([R, R])).toThrow(/^usage: /);
    expect(() => C(["-x"])).toThrow(/^usage: /);
    const D = doctor.parseDoctorArgs as Parse;
    expect(D([])).toEqual({});
    expect(D(["--"])).toEqual({});
    expect(() => D(["x"])).toThrow(/^usage: /);
  });
});

describe("WI-9 RX-07 the real shim", () => {
  it("node scripts/control/launch.mjs --via bogus: exit 2, usage last, no I/O", () => {
    const home = tmp("/tmp/rh-");
    const tmpdir = tmp("/tmp/rt-");
    const cwd = tmp("/tmp/rc-");
    const r = spawnSync(process.execPath, [path.join(REPO, "scripts/control/launch.mjs"), "--via", "bogus"], {
      cwd,
      env: { PATH: process.env.PATH, HOME: home, TMPDIR: tmpdir },
      encoding: "utf8",
      timeout: 20_000,
    });
    expect(r.status).toBe(2);
    const lines = r.stdout.split("\n").filter((l) => l !== "");
    expect(lines.at(-1)).toMatch(/^usage: /);
    for (const d of [home, tmpdir, cwd]) expect(fs.readdirSync(d)).toEqual([]);
  });

  it("package.json carries the four verbs", () => {
    const scripts = JSON.parse(fs.readFileSync(path.join(REPO, "package.json"), "utf8")).scripts;
    for (const verb of ["doctor", "launch", "quit", "clean"]) {
      expect(scripts[`control:${verb}`], verb).toBe(`node scripts/control/${verb}.mjs`);
    }
  });
});
