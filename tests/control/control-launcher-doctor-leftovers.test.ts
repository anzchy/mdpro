// @vitest-environment node
/**
 * D174-WI-1: `doctor` reports every lock leftover in the runs parent, one
 * `[info] lock leftover <name>: …` line per file: `.lock.mutex`,
 * `.lock.mutex.break`, `.clean.<run>` (holder pid and its ESRCH-only
 * liveness: alive, dead or unknown), `.lock.*.tomb` (the run its record
 * names), the `.lock.mutex*.tmp` / `.clean.*.tmp` temps, and unreadable or
 * irregular files. A removal command `rm '<absolute path>'` appears exactly
 * when the file is provably safe to remove (dead holder, tomb, unreadable,
 * temp). Doctor itself removes nothing and prints no token or digest.
 *
 * The verdict and exit (D174-WI-2) are not asserted here. Lines are pinned as
 * literals. Everything is real: a tmp runs parent, a live child pid, an
 * exited child pid, pid 1 for EPERM.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DIGEST,
  RUN,
  TOKEN,
  canEperm,
  deadPid,
  doctor,
  holderBody,
  leftoverLines,
  liveChild,
  makeEnv,
  put,
  tombBody,
  type Env,
} from "../support/lockLeftovers";

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
async function alivePid(): Promise<number> {
  const c = await liveChild();
  disposers.push(c.stop);
  return c.pid;
}

const MUTEX = ".lock.mutex";
const BREAK = ".lock.mutex.break";
const CLEAN = `.clean.${RUN}`;
const TOMB = ".lock.4242-89abcdef01234567.tomb";
const rm = (file: string) => `remove: rm '${file}'`;

describe("D174-WI-1 doctor: what is and is not a lock leftover", () => {
  it("LL-01 an empty runs parent and unrelated entries print no leftover line", async () => {
    const e = env();
    expect(leftoverLines((await doctor(e)).lines)).toEqual([]);
    fs.mkdirSync(path.join(e.parent, "b".repeat(25)), { mode: 0o700 });
    put(e, "notes.txt", "x");
    put(e, ".clean.not-a-run", holderBody(await deadPid()));
    put(e, ".lockx", "x");
    put(e, ".lock.mutexy", "x");
    expect(leftoverLines((await doctor(e)).lines)).toEqual([]);
  });
});

describe("D174-WI-1 doctor: holder files ({ pid, token })", () => {
  // rule 12: D174-WI-1 recorded BREAK as "blocks launches; "; D179-WI-2 corrects it
  // (audit b80, device C7). D179-WI-2: a break file alone blocks nothing (acquire reads it only when
  // `.lock.mutex` exists); the break-beside-mutex cases are in
  // control-launcher-doctor-leftovers-break.test.ts.
  const BLOCKS: Record<string, string> = { [MUTEX]: "blocks launches; ", [BREAK]: "", [CLEAN]: `blocks clean ${RUN}; ` };

  it.each([MUTEX, BREAK, CLEAN])("LL-02 %s with a live holder: pid alive, in use, no removal command", async (name) => {
    const e = env();
    const pid = await alivePid();
    put(e, name, holderBody(pid));
    expect(leftoverLines((await doctor(e)).lines)).toEqual([`[info] lock leftover ${name}: holder pid ${pid} alive, in use`]);
  });

  it.each([
    [MUTEX, ""],
    // rule 12: was "blocks launches; " under D174-WI-1; D179-WI-2 (b80).
    [BREAK, ""],
    [CLEAN, ""],
  ])("LL-03 %s with a dead (ESRCH) holder: pid dead and the exact rm", async (name, blocks) => {
    const e = env();
    const pid = await deadPid();
    const file = put(e, name, holderBody(pid));
    expect(leftoverLines((await doctor(e)).lines)).toEqual([
      `[info] lock leftover ${name}: holder pid ${pid} dead; ${blocks}${rm(file)}`,
    ]);
  });

  it.skipIf(!canEperm).each([MUTEX, BREAK, CLEAN])(
    "LL-04 %s held by pid 1 (EPERM): liveness unknown, no rm, check by hand",
    async (name) => {
      const e = env();
      put(e, name, holderBody(1));
      expect(leftoverLines((await doctor(e)).lines)).toEqual([
        `[info] lock leftover ${name}: holder pid 1 unknown (EPERM); ${BLOCKS[name]}check pid 1, then remove it by hand`,
      ]);
    },
  );

  const BAD: [string, string, string][] = [
    ["empty", "", "empty"],
    ["partial JSON", '{"pid":', "not a {pid, token} record"],
    ["pid 0", JSON.stringify({ pid: 0, token: TOKEN }), "not a {pid, token} record"],
    ["bad token", JSON.stringify({ pid: 4242, token: "xyz" }), "not a {pid, token} record"],
  ];
  for (const name of [MUTEX, BREAK, CLEAN]) {
    it.each(BAD)(`LL-05 ${name} %s: unreadable, may be a crash leftover, with the rm`, async (_row, body, why) => {
      const e = env();
      const file = put(e, name, body);
      expect(leftoverLines((await doctor(e)).lines)).toEqual([
        `[info] lock leftover ${name}: unreadable (${why}), may be a crash leftover; ${BLOCKS[name]}${rm(file)}`,
      ]);
    });
  }

  it("LL-06 a directory named .lock.mutex: not a regular file, no rm, inspect by hand", async () => {
    const e = env();
    fs.mkdirSync(path.join(e.parent, MUTEX));
    expect(leftoverLines((await doctor(e)).lines)).toEqual([
      `[info] lock leftover ${MUTEX}: not a regular file; blocks launches; inspect it by hand`,
    ]);
  });
});

describe("D174-WI-1 doctor: tombs and temps", () => {
  it("LL-07 a tomb names the run of its record and gives the rm", async () => {
    const e = env();
    const file = put(e, TOMB, tombBody(RUN));
    expect(leftoverLines((await doctor(e)).lines)).toEqual([
      `[info] lock leftover ${TOMB}: tomb of run ${RUN}; blocks launches; ${rm(file)}`,
    ]);
  });

  it.each([
    ["empty", "", "empty"],
    ["not JSON", "{", "not a lock record"],
    ["a run that is not a run name", tombBody("../x"), "not a lock record"],
  ])("LL-08 a tomb whose record is %s: unreadable, with the rm", async (_row, body, why) => {
    const e = env();
    const file = put(e, TOMB, body);
    expect(leftoverLines((await doctor(e)).lines)).toEqual([
      `[info] lock leftover ${TOMB}: tomb, record unreadable (${why}), may be a crash leftover; blocks launches; ${rm(file)}`,
    ]);
  });

  it.each([".lock.mutex.4242-fedcba9876543210.tmp", ".lock.mutex.break.4242-fedcba9876543210.tmp", `.clean.${RUN}.4242-fedcba9876543210.tmp`])(
    "LL-09 the temp %s: nothing reads it, with the rm",
    async (name) => {
      const e = env();
      const file = put(e, name, holderBody(await alivePid()));
      expect(leftoverLines((await doctor(e)).lines)).toEqual([
        `[info] lock leftover ${name}: temp file, nothing reads it (a crash leftover); ${rm(file)}`,
      ]);
    },
  );
});

describe("D174-WI-1 doctor: the command, the order, and what doctor never does", () => {
  it("LL-10 a name with a quote and a space: the printed rm, run by /bin/sh, removes exactly that file", async () => {
    const e = env();
    const name = ".lock.it's x.tomb";
    const file = put(e, name, tombBody(RUN));
    const keep = put(e, TOMB, tombBody(RUN));
    const lines = leftoverLines((await doctor(e)).lines);
    const line = lines.find((l) => l.startsWith(`[info] lock leftover ${name}: `)) as string;
    const quoted = `'${file.replace(/'/g, `'\\''`)}'`;
    expect(line).toBe(`[info] lock leftover ${name}: tomb of run ${RUN}; blocks launches; remove: rm ${quoted}`);
    const cmd = line.slice(line.indexOf("remove: ") + "remove: ".length);
    execFileSync("/bin/sh", ["-c", cmd]);
    expect(fs.existsSync(file)).toBe(false);
    expect(fs.existsSync(keep)).toBe(true);
  });

  // Rule 12 (D174-WI-1, after the red): this case was recorded with a newline
  // in the name. lockTomb's TOMB_RE (`.` without the `s` flag) never counts
  // such a name as a tomb, so acquire never refuses on it and doctor must not
  // call it one (LL-13 now pins that). A tab is a control byte `.` matches,
  // which keeps the case's subject: escaped on one line, no rm.
  it("LL-11 a name with a control byte stays on one line, escaped, with no rm", async () => {
    const e = env();
    const name = ".lock.a\tb.tomb";
    put(e, name, tombBody(RUN));
    const r = await doctor(e);
    expect(r.lines.every((l) => !l.includes("\n"))).toBe(true);
    expect(leftoverLines(r.lines)).toEqual([
      `[info] lock leftover ${JSON.stringify(name)}: tomb of run ${RUN}; blocks launches; inspect it by hand`,
    ]);
  });

  it("LL-13 a name with a newline is not a tomb to the lock code, so doctor lists nothing", async () => {
    const e = env();
    put(e, ".lock.a\nb.tomb", tombBody(RUN));
    const r = await doctor(e);
    expect(r.lines.every((l) => !l.includes("\n"))).toBe(true);
    expect(leftoverLines(r.lines)).toEqual([]);
  });

  it("LL-12 one line per leftover, in name order; doctor changes nothing and prints no token or digest", async () => {
    const e = env();
    const live = await alivePid();
    const dead = await deadPid();
    const seeded = [
      put(e, MUTEX, holderBody(dead)),
      put(e, BREAK, holderBody(live)),
      put(e, CLEAN, ""),
      put(e, TOMB, tombBody(RUN)),
      put(e, ".lock.mutex.4242-fedcba9876543210.tmp", holderBody(live)),
      put(e, `.clean.${RUN}.4242-fedcba9876543210.tmp`, holderBody(live)),
    ];
    const snap = () =>
      fs
        .readdirSync(e.parent)
        .sort()
        .map((n) => {
          const p = path.join(e.parent, n);
          const st = fs.lstatSync(p);
          return { n, mode: st.mode, mtimeMs: st.mtimeMs, bytes: fs.readFileSync(p, "utf8") };
        });
    const before = snap();
    const r1 = await doctor(e);
    const r2 = await doctor(e);
    expect(snap()).toEqual(before);
    expect(r2.lines).toEqual(r1.lines);
    const names = leftoverLines(r1.lines).map((l) => (/^\[info\] lock leftover (\S+): /.exec(l) as RegExpExecArray)[1]);
    expect(names).toEqual(seeded.map((f) => path.basename(f)).sort());
    const text = r1.lines.join("\n");
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain(DIGEST);
    // The rm appears on exactly the lines whose file is provably safe to remove.
    const withRm = leftoverLines(r1.lines).filter((l) => l.includes("; remove: rm '"));
    expect(withRm.map((l) => (/^\[info\] lock leftover (\S+): /.exec(l) as RegExpExecArray)[1])).toEqual(
      [MUTEX, CLEAN, TOMB, ".lock.mutex.4242-fedcba9876543210.tmp", `.clean.${RUN}.4242-fedcba9876543210.tmp`].sort(),
    );
  });
});
