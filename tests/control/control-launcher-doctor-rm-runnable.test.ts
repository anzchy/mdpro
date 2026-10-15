// @vitest-environment node
/**
 * D179-WI-1: the `remove: rm …` lines `pnpm control:doctor` prints must run.
 * Found on a device: `doctorLeftovers` single-quotes the absolute path, then
 * `launcherCli.main` passes every stdout line through `redact`, which turned
 * the home prefix into `~` inside the quotes (`rm '~/Library/…'`). `~` does
 * not expand inside single quotes, so the printed command failed. The D174
 * tests checked the line before redaction only.
 *
 * Here the two layers run together: the real `main("doctor")` with the real
 * doctor driver over a runs parent under a temp home (whose path has the
 * runs parent's `Application Support` space), each printed rm executed by
 * `/bin/sh -c` with HOME set to that home. Plus `redact` itself on the quoted
 * and unquoted shapes.
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { fakeProcFacts, makeHome } from "../support/launcherFakes";
import { RUN, makeEnv, put, tombBody, type Env } from "../support/lockLeftovers";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { main } from "../../scripts/control/launcherCli.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { run as doctorRun } from "../../scripts/control/doctor.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { redact } from "../../scripts/control/launcherFormat.mjs";

let disposers: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const d of disposers.reverse()) await d();
  disposers = [];
});
function env(): Env {
  const e = makeEnv();
  disposers.push(e.dispose);
  return e;
}

/** The real CLI path: `main("doctor")` → the doctor driver → redacted stdout, home = the runs parent's home. */
async function cliDoctor(e: Env, homeDir: string): Promise<{ code: number; out: string[] }> {
  const out: string[] = [];
  const code = await main("doctor", [], {
    run: (a: unknown, d: Record<string, unknown>) =>
      doctorRun(a, {
        repoRoot: e.repo,
        passwdHome: e.home,
        siSockPath: `/tmp/drm-${process.pid}-absent.sock`,
        procFacts: fakeProcFacts(),
        ...d,
      }),
    out: (l: string) => out.push(l),
    err: () => {},
    repoRoot: e.repo,
    homeDir,
  });
  return { code, out };
}

const rmOf = (line: string) => line.slice(line.indexOf("remove: ") + "remove: ".length);

describe("D179-WI-1 the printed rm runs under /bin/sh after redaction", () => {
  it("DR-01 a tomb, a tomb named with a quote and a space, and a temp: every printed rm removes its file", async () => {
    const e = env();
    const home = fs.realpathSync(e.home);
    const files = [
      put(e, ".lock.4242-89abcdef01234567.tomb", tombBody(RUN)),
      put(e, ".lock.it's x.tomb", tombBody(RUN)),
      put(e, ".lock.mutex.4242-fedcba9876543210.tmp", ""),
    ];
    expect(e.parent.startsWith(`${home}/`)).toBe(true);
    expect(e.parent).toContain(" ");
    const r = await cliDoctor(e, home);
    expect(r.out.join("\n")).not.toContain(home);
    const rms = r.out.filter((l) => l.includes("; remove: rm ")).map(rmOf);
    expect(rms).toHaveLength(3);
    for (const cmd of rms) {
      const run = spawnSync("/bin/sh", ["-c", cmd], { env: { PATH: process.env.PATH, HOME: home }, encoding: "utf8" });
      // sh's own error text is not echoed: tdd-guardian reads it as a missing runner.
      expect({ cmd, status: run.status, quiet: run.stderr === "" }).toEqual({ cmd, status: 0, quiet: true });
    }
    for (const f of files) expect(fs.existsSync(f), f).toBe(false);
    expect(fs.readdirSync(e.parent)).toEqual([]);
  });
});

describe("D179-WI-1 redact is quote-aware for the home", () => {
  const H = "/Users/u";
  const o = { secrets: [], homeDir: H };
  const shWord = (word: string, home: string) =>
    execFileSync("/bin/sh", ["-c", `printf '%s' ${word}`], { env: { PATH: process.env.PATH, HOME: home }, encoding: "utf8" });

  it("DQ-01 a single-quoted path starting with the home becomes ~/'rest'", () => {
    expect(redact(`rm '${H}/Library/Application Support/x'`, o)).toBe(`rm ~/'Library/Application Support/x'`);
    expect(redact(`'${H}/a'`, o)).toBe(`~/'a'`);
  });

  it("DQ-02 the quoted home alone becomes ~", () => {
    expect(redact(`cd '${H}'`, o)).toBe("cd ~");
    expect(redact(`'${H}'`, o)).toBe("~");
  });

  it("DQ-03 unquoted occurrences keep the plain ~ form", () => {
    expect(redact(`at ${H}/y and ${H}`, o)).toBe("at ~/y and ~");
  });

  it("DQ-04 an embedded '\\'' escape still round-trips after redaction", () => {
    const quoted = `'${H}/it'\\''s x/f'`;
    expect(redact(`rm ${quoted}`, o)).toBe(`rm ~/'it'\\''s x/f'`);
  });

  it("DQ-05 every redacted quoted word expands under sh to the original path; a second pass changes nothing", () => {
    const home = makeHome();
    disposers.push(home.cleanup);
    const real = home.real;
    for (const rest of ["", "/a", "/Library/Application Support/x", "/it's here/f", "/a'b'c"]) {
      const p = `${real}${rest}`;
      const word = `'${p.replace(/'/g, `'\\''`)}'`;
      const red = redact(word, { secrets: [], homeDir: real });
      expect(red, p).not.toContain(real);
      expect(shWord(red, real), p).toBe(p);
      expect(redact(red, { secrets: [], homeDir: real })).toBe(red);
    }
  });

  it("DQ-06 a quoted path that merely shares the home's prefix is not rewritten to ~/'…'", () => {
    expect(redact(`'${H}son/x'`, o)).not.toContain("~/'");
  });
});
