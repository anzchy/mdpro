// @vitest-environment node
/**
 * D148-WI-3: the clean marker `.clean.<run>` never exists incomplete. A cleaner
 * killed while claiming must not leave an empty or partial marker, which every
 * later `clean R` would refuse as `clean marker unreadable` while R's lock stays.
 * The claim writes the full body to a unique temp file in the same directory
 * and links it onto the marker name (EEXIST still refuses), then always
 * removes the temp.
 *
 * Real fs, real lock, real mutex. The kill is either a real SIGKILL of a child
 * process at the point between "the marker is created" and "the marker is
 * complete" (patched at its fs boundary), or an in-process throw at the same
 * point. A marker left incomplete by older code still refuses, naming the file.
 * Matrix: audit b67 of D148, D148-WI-3, CA-1..CA-6.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { walk } from "../support/launchHarness";
import { DF, disposeAll, NAME, NONCE, type Probe, runFixture } from "../support/cleanSockFixtures";
import { cleanupParents, freshParent, recordBytes } from "../support/lockSchedules";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { claimClean, dropClean } from "../../scripts/control/cleanClaim.mjs";

afterEach(async () => {
  vi.restoreAllMocks();
  cleanupParents();
  await disposeAll();
});

const MARKER = `.clean.${NAME}`;
const REMOVED = `clean: removed ${NAME}`;
const TOKEN = "0123456789abcdef";
const MOD = pathToFileURL(path.resolve(__dirname, "../../scripts/control/cleanClaim.mjs")).href;
const realWrite = fs.writeFileSync;
const realLink = fs.linkSync;

const entries = (dir: string) => fs.readdirSync(dir).sort();
const lockBytes = (dir: string) => (fs.existsSync(path.join(dir, ".lock")) ? fs.readFileSync(path.join(dir, ".lock"), "utf8") : null);

/**
 * A child process claims `run` in `parent` and SIGKILLs itself between the
 * marker being created and being complete: on a direct write of the marker it
 * creates the file empty and dies; on a link onto the marker it dies before the
 * link. Whichever way the claim builds the marker, the kill lands in that gap.
 */
const CHILD = `
import fs from "node:fs";
import path from "node:path";
const { CA_PARENT: parent, CA_RUN: run, CA_MOD: mod } = process.env;
const marker = path.join(parent, ".clean." + run);
const die = () => { process.kill(process.pid, "SIGKILL"); for (;;) {} };
const realWrite = fs.writeFileSync;
const realLink = fs.linkSync;
fs.writeFileSync = (file, data, opts) => {
  if (file === marker) { fs.closeSync(fs.openSync(file, (opts && opts.flag) || "w", opts && opts.mode)); die(); }
  return realWrite(file, data, opts);
};
fs.linkSync = (from, to) => { if (to === marker) die(); return realLink(from, to); };
const { claimClean } = await import(mod);
claimClean(parent, run);
`;

function killedClaim(parent: string, run: string) {
  return spawnSync(process.execPath, ["--input-type=module", "-e", CHILD], {
    env: { ...process.env, CA_PARENT: parent, CA_RUN: run, CA_MOD: MOD },
    encoding: "utf8",
  });
}

/** Throw at the same gap, in this process: an empty marker then a throw on a direct write; a throw before a link. */
function crashAtMarker(parent: string, run: string) {
  const marker = path.join(parent, `.clean.${run}`);
  vi.spyOn(fs, "writeFileSync").mockImplementation(((...a: Parameters<typeof fs.writeFileSync>) => {
    if (a[0] === marker) {
      const o = (a[2] ?? {}) as fs.WriteFileOptions & { flag?: string; mode?: number };
      fs.closeSync(fs.openSync(marker, o.flag ?? "w", o.mode));
      throw new Error("simulated crash");
    }
    return realWrite(...a);
  }) as typeof fs.writeFileSync);
  vi.spyOn(fs, "linkSync").mockImplementation(((from: fs.PathLike, to: fs.PathLike) => {
    if (to === marker) throw new Error("simulated crash");
    return realLink(from, to);
  }) as typeof fs.linkSync);
}

describe("D148-WI-3 a cleaner killed while claiming leaves no incomplete marker", () => {
  it("CA-1 SIGKILL between create and complete: no .clean.<run>, and the next clean R removes R and frees its lock", async () => {
    const fx = runFixture({ probe: async (): Promise<Probe> => "absent" });
    const killed = killedClaim(fx.parent, NAME);
    expect({ signal: killed.signal, stderr: killed.stderr }).toEqual({ signal: "SIGKILL", stderr: "" });
    expect(entries(fx.parent)).not.toContain(MARKER);
    const r = await fx.clean();
    expect({ exit: r.exit, out: fx.out }).toEqual({ exit: 0, out: [REMOVED, "verdict: pass"] });
    // Whatever the killed claim left (a temp, a dead holder's mutex) neither blocks nor survives as a marker, lock or mutex.
    const rest = entries(fx.parent).filter((n) => !/^\.clean\..+\.tmp$/.test(n));
    expect(rest).toEqual([]);
  });

  it("CA-2 a throw at that point: the claim fails, and leaves no marker, no temp and no mutex; the next claim succeeds", () => {
    const p = freshParent();
    crashAtMarker(p, NAME);
    expect(() => claimClean(p, NAME)).toThrow("simulated crash");
    vi.restoreAllMocks();
    expect(entries(p)).toEqual([]);
    const token = claimClean(p, NAME);
    expect(JSON.parse(fs.readFileSync(path.join(p, MARKER), "utf8"))).toEqual({ pid: process.pid, token });
    expect(dropClean(p, NAME, token)).toBe(true);
    expect(entries(p)).toEqual([]);
  });

  it("CA-3 leftover temp files (partial, or a full live body) block nothing: clean R passes", async () => {
    const fx = runFixture({ probe: async (): Promise<Probe> => "absent" });
    const partial = `${MARKER}.99999-deadbeef.tmp`;
    const full = `${MARKER}.${process.pid}-0badc0de.tmp`;
    fs.writeFileSync(path.join(fx.parent, partial), '{"pid":', { mode: 0o600 });
    fs.writeFileSync(path.join(fx.parent, full), JSON.stringify({ pid: process.pid, token: TOKEN }), { mode: 0o600 });
    const r = await fx.clean();
    expect({ exit: r.exit, out: fx.out }).toEqual({ exit: 0, out: [REMOVED, "verdict: pass"] });
    expect(entries(fx.parent)).toEqual([full, partial].sort());
  });
});

describe("D148-WI-3 the claim still refuses an existing marker, and leaves nothing of its own", () => {
  it("CA-4 a marker appearing before the link (EEXIST) refuses: that marker kept byte-identical, no temp, no mutex", () => {
    const p = freshParent();
    const marker = path.join(p, MARKER);
    const theirs = JSON.stringify({ pid: process.pid, token: TOKEN });
    let injected = false;
    vi.spyOn(fs, "writeFileSync").mockImplementation(((...a: Parameters<typeof fs.writeFileSync>) => {
      realWrite(...a);
      const name = path.basename(String(a[0]));
      if (!injected && path.dirname(String(a[0])) === p && name.startsWith(`${MARKER}.`) && name.endsWith(".tmp")) {
        injected = true;
        realWrite(marker, theirs, { mode: 0o600 });
      }
    }) as typeof fs.writeFileSync);
    let code: unknown = null;
    try {
      claimClean(p, NAME);
    } catch (e) {
      code = (e as NodeJS.ErrnoException).code;
    }
    vi.restoreAllMocks();
    expect({ injected, code }).toEqual({ injected: true, code: "EEXIST" });
    expect(fs.readFileSync(marker, "utf8")).toBe(theirs);
    expect(entries(p)).toEqual([MARKER]);
  });

  it("CA-5 law: claim then drop is a round trip; over 20 cycles the marker is complete while held and nothing is left", () => {
    const p = freshParent();
    const tokens = new Set<string>();
    for (let i = 0; i < 20; i += 1) {
      const token = claimClean(p, NAME);
      tokens.add(token);
      expect(entries(p)).toEqual([MARKER]);
      expect(JSON.parse(fs.readFileSync(path.join(p, MARKER), "utf8"))).toEqual({ pid: process.pid, token });
      expect(dropClean(p, NAME, token)).toBe(true);
      expect(entries(p)).toEqual([]);
    }
    expect(tokens.size).toBe(20);
  });
});

describe("D148-WI-3 a marker left incomplete by older code still refuses, naming the file", () => {
  it.each([
    ["empty", ""],
    ["truncated", '{"pid":4'],
    ["no token", `{"pid":${process.pid}}`],
  ])("CA-6 %s marker: clean R refuses with the file's name; marker, R and the lock unchanged; no temp", async (_k, bytes) => {
    const fx = runFixture({ probe: async (): Promise<Probe> => "absent" });
    const marker = path.join(fx.parent, MARKER);
    fs.writeFileSync(marker, bytes, { mode: 0o600 });
    const before = walk(fx.lay.runDir);
    const r = await fx.clean();
    expect({ exit: r.exit, out: fx.out }).toEqual({ exit: 1, out: [`${DF}clean marker unreadable (${MARKER})`] });
    expect(fs.readFileSync(marker, "utf8")).toBe(bytes);
    expect(walk(fx.lay.runDir)).toEqual(before);
    expect(lockBytes(fx.parent)).toBe(recordBytes(NAME, NONCE));
    expect(entries(fx.parent)).toEqual([MARKER, NAME, ".lock"].sort());
  });
});
