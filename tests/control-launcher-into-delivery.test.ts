// @vitest-environment node
/**
 * ADR-0047 WI-003 device-check fix WI-R3: `launch --into <run>` must prove the
 * file reached the run. `--into --via open` runs `open` without `-n`, and a
 * pass needs the second process to exit 0 **and** R's app log
 * (`layout(...).appLog`) to gain, after the pre-spawn offset and before the
 * deadline, a `file.open.external` / `success` line for the file.
 * Matrix: `.claude/tdd-guardian/tests-20261008-144444.md`, "Round 5 changes
 * (device check D, WI-R3)", IR-1..IR-10, plus IR-C1 (characterization of
 * `--into` with no file, not red).
 *
 * Law pinned here: `--into R <file>` prints `verdict: pass` iff the second
 * process exits 0 and a matching delivery line is appended in the window;
 * no outcome signals a pid or changes `.lock`, `owner.json`,
 * `instance.json` or `launch.json`, and no outcome prints or logs the nonce.
 *
 * Shared fixture: `tests/support/launchHarness.ts`; fakes only at
 * `deps.spawn`, `deps.procFacts`, `deps.kill` and the clock. The fake app
 * "delivers" by appending lines to R's real app log on a tmp fs.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BUNDLE, last, launchFixture, launcherText, logLines, NONCE, type Fixture } from "./support/launchHarness";
import { fakeSpawn, type SpawnScript } from "./support/launcherFakes";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { HANDSHAKE_TIMEOUT_MS, run } from "../scripts/control/launch.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { openArgv, POLL_MS } from "../scripts/control/launchCore.mjs";

type Result = { exit: number; lines: string[] };
const T: number = HANDSHAKE_TIMEOUT_MS;
const P: number = POLL_MS;
const NOT_DELIVERED = `verdict: fail — into: file not delivered within ${T} ms`;

let cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups) c();
  cleanups = [];
});

/** A tmp dir holding `b.md`, `other.md` and `link.md -> b.md`; paths as given (lexical) and real. */
function docs() {
  const dir = fs.mkdtempSync("/tmp/ir");
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  const b = path.join(dir, "b.md");
  const other = path.join(dir, "other.md");
  const link = path.join(dir, "link.md");
  fs.writeFileSync(b, "# b\n");
  fs.writeFileSync(other, "# other\n");
  fs.symlinkSync(b, link);
  return { b, other, link, bReal: fs.realpathSync(b), otherReal: fs.realpathSync(other) };
}

/** One JSONL line the way `logger::log_event` writes it. */
const entry = (event: string, status: string, context: Record<string, unknown>) =>
  `${JSON.stringify({ timestamp: "2026-10-09T00:00:00Z", level: "info", event, status, context })}\n`;
const delivered = (filePath: string, source = "finder") => entry("file.open.external", "success", { filePath, source });

/** The Check D lines: a fresh instance that handed off an empty argv. */
const CHECK_D = [
  entry("app.launch", "success", { version: "0.0.0" }),
  entry("window.blur", "success", {}),
  entry("file.open.args_filtered", "success", { accepted: 0, source: "single_instance" }),
  entry("window.focus", "success", {}),
];

const appendApp = (fx: Fixture, text: string) => {
  fs.mkdirSync(path.dirname(fx.lay.appLog), { recursive: true });
  fs.appendFileSync(fx.lay.appLog, text);
};

/** The bytes of every run-identity record. */
const records = (fx: Fixture) =>
  [path.join(fx.parent, ".lock"), fx.lay.ownerJson, fx.lay.instanceJson, fx.lay.launchJson].map((p) => fs.readFileSync(p, "utf8"));

/**
 * A second process (`open` or the main binary) that writes `writes` into R's
 * app log, each `at` ms after the spawn (0 = during the spawn call), and exits `code`.
 */
const app =
  (fx: Fixture, writes: { at: number; text: string }[], code = 0): SpawnScript =>
  (_call, child) => {
    const t0 = fx.clock.now();
    for (const w of writes) {
      if (w.at === 0) appendApp(fx, w.text);
      else fx.clock.at(t0 + w.at, () => appendApp(fx, w.text));
    }
    child.exitSoon(code);
  };

/** A live run R from a real (faked-boundary) launch; `into` runs `--into R` with a fresh second-process spawn. */
async function liveRun() {
  const fx = launchFixture();
  cleanups.push(fx.cleanup);
  const first: Result = await run({ file: "/tmp/f.md" }, fx.deps);
  expect(first.exit).toBe(0);
  fx.out.length = 0;
  const before = records(fx);
  const into = async (script: (fx: Fixture) => SpawnScript, args: Record<string, unknown>) => {
    const second = fakeSpawn(script(fx), [6000]);
    fx.deps.spawn = second;
    const r: Result = await run({ into: fx.name, ...args }, fx.deps);
    return { r, second };
  };
  /** Nothing signalled, run identity untouched, nonce never printed or logged. */
  const expectInert = (second: ReturnType<typeof fakeSpawn>) => {
    expect(fx.kill.calls).toEqual([]);
    for (const c of second.calls) expect(c.child.signals).toEqual([]);
    expect(records(fx)).toEqual(before);
    expect(launcherText(fx)).not.toContain(NONCE);
  };
  return { fx, into, expectInert };
}

const lastInto = (fx: Fixture) =>
  logLines(fx.lay.runDir)
    .filter((e) => e.event === "launcher.into")
    .at(-1) as Record<string, unknown> | undefined;

describe("WI-R3 IR-1 openArgv for --into", () => {
  it("IR-1 no -n: the four --env pairs, -a <bundle>, then the file, in order; the default keeps -n", () => {
    const runDirReal = "/r/R";
    const env = ["--env", `MDPRO_VERIFY_RUN=${runDirReal}`, "--env", `MDPRO_VERIFY_NONCE=${NONCE}`, "--env", `HOME=${runDirReal}`, "--env", `CFFIXED_USER_HOME=${runDirReal}`];
    const into = openArgv({ runDirReal, nonce: NONCE, bundle: BUNDLE, file: "/d/b.md", newInstance: false });
    expect(into).toEqual([...env, "-a", BUNDLE, "/d/b.md"]);
    expect(into).not.toContain("-n");
    expect(openArgv({ runDirReal, nonce: NONCE, bundle: BUNDLE, file: "/d/b.md" })).toEqual(["-n", ...env, "-a", BUNDLE, "/d/b.md"]);
  });
});

describe("WI-R3 launch --into: delivery is proved from R's app log", () => {
  it("IR-2 --into --via open spawns open without -n", async () => {
    const d = docs();
    const { fx, into } = await liveRun();
    const { second } = await into((f) => app(f, [{ at: 0, text: delivered(d.bReal) }]), { via: "open", file: d.b });
    expect(second.calls).toHaveLength(1);
    expect(second.calls[0].cmd).toBe("open");
    expect(second.calls[0].args).not.toContain("-n");
    const runReal = fs.realpathSync(fx.lay.runDir);
    expect(second.calls[0].args).toEqual([
      "--env",
      `MDPRO_VERIFY_RUN=${runReal}`,
      "--env",
      `MDPRO_VERIFY_NONCE=${NONCE}`,
      "--env",
      `HOME=${runReal}`,
      "--env",
      `CFFIXED_USER_HOME=${runReal}`,
      "-a",
      BUNDLE,
      d.b,
    ]);
  });

  it("IR-3 Check D: open exits 0, the log gains only the hand-off lines: not delivered, nothing killed", async () => {
    const d = docs();
    const { fx, into, expectInert } = await liveRun();
    const { r, second } = await into((f) => app(f, CHECK_D.map((text) => ({ at: 0, text }))), { via: "open", file: d.b });
    expect(last(fx.out)).toBe(NOT_DELIVERED);
    expect(r.exit).toBe(1);
    expect(fx.out).not.toContain("verdict: pass");
    expectInert(second);
    expect(lastInto(fx)).toMatchObject({ event: "launcher.into", outcome: expect.stringContaining("not delivered") });
  });

  it.each([
    { row: "poll 0", at: 0 },
    { row: "a later poll", at: 2 * P },
    { row: "last poll before the deadline", at: T - P },
  ])("IR-4 --via open, delivery line at $row: delivered (source finder), pass", async ({ at }) => {
    const d = docs();
    const { fx, into, expectInert } = await liveRun();
    const { r, second } = await into((f) => app(f, [{ at, text: delivered(d.bReal) }]), { via: "open", file: d.b });
    expect(fx.out.slice(-2)).toEqual([`into: run ${fx.name} file delivered (source finder)`, "verdict: pass"]);
    expect(r.exit).toBe(0);
    expectInert(second);
  });

  it("IR-4 --via open, delivery line only after the deadline: not delivered", async () => {
    const d = docs();
    const { fx, into, expectInert } = await liveRun();
    const { r, second } = await into((f) => app(f, [{ at: T + P, text: delivered(d.bReal) }]), { via: "open", file: d.b });
    expect(last(fx.out)).toBe(NOT_DELIVERED);
    expect(r.exit).toBe(1);
    expectInert(second);
  });

  it("IR-5 direct exec, child exits 0, no delivery line: not delivered, the child is not killed", async () => {
    const d = docs();
    const { fx, into, expectInert } = await liveRun();
    const { r, second } = await into((f) => app(f, CHECK_D.map((text) => ({ at: 0, text }))), { file: d.b });
    expect(second.calls[0].args).toEqual([d.b]);
    expect(last(fx.out)).toBe(NOT_DELIVERED);
    expect(r.exit).toBe(1);
    expectInert(second);
    expect(lastInto(fx)).toMatchObject({ event: "launcher.into", outcome: expect.stringContaining("not delivered") });
  });

  it.each([
    { row: "realpath", which: "bReal" as const },
    { row: "the path as given", which: "b" as const },
  ])("IR-6 direct exec, single_instance delivery naming $row: pass", async ({ which }) => {
    const d = docs();
    const { fx, into, expectInert } = await liveRun();
    const { r, second } = await into((f) => app(f, [{ at: P, text: delivered(d[which], "single_instance") }]), { file: d.b });
    expect(fx.out.slice(-2)).toEqual([`into: run ${fx.name} file delivered (source single_instance)`, "verdict: pass"]);
    expect(r.exit).toBe(0);
    expectInert(second);
  });

  type Miss = { row: string; via?: string; pre?: (fx: Fixture, d: ReturnType<typeof docs>) => void; writes: (d: ReturnType<typeof docs>) => { at: number; text: string }[] };
  const MISSES: Miss[] = [
    { row: "a line for another file", writes: (d) => [{ at: 0, text: delivered(d.otherReal) }] },
    {
      row: "a status start line only",
      writes: (d) => [{ at: 0, text: entry("file.open.external", "start", { filePaths: [d.bReal], filePath: d.bReal, source: "single_instance" }) }],
    },
    { row: "a matching line written before the spawn", pre: (fx, d) => appendApp(fx, delivered(d.bReal)), writes: () => [] },
    { row: "a matching line written before the spawn (via open)", via: "open", pre: (fx, d) => appendApp(fx, delivered(d.bReal)), writes: () => [] },
    { row: "file.open.route only", writes: (d) => [{ at: 0, text: entry("file.open.route", "success", { filePath: d.bReal, route: "new-window" }) }] },
    { row: "the app log missing entirely", writes: () => [] },
    {
      row: "a malformed line and a partial trailing line",
      writes: (d) => [{ at: 0, text: `{"event":"file.open.external",\n${delivered(d.bReal).trimEnd()}` }],
    },
    { row: "a success line with no context", writes: () => [{ at: 0, text: `${JSON.stringify({ event: "file.open.external", status: "success" })}\n` }] },
  ];
  it.each(MISSES)("IR-7 near miss ($row): not delivered, no throw, nothing killed", async ({ via, pre, writes }) => {
    const d = docs();
    const { fx, into, expectInert } = await liveRun();
    pre?.(fx, d);
    const { r, second } = await into((f) => app(f, writes(d)), { file: d.b, ...(via ? { via } : {}) });
    expect(last(fx.out)).toBe(NOT_DELIVERED);
    expect(r.exit).toBe(1);
    expectInert(second);
  });

  it("IR-8 a malformed line, then a valid matching line later: pass (bad lines skipped)", async () => {
    const d = docs();
    const { fx, into, expectInert } = await liveRun();
    const { r, second } = await into(
      (f) =>
        app(f, [
          { at: 0, text: "not json at all\n" },
          { at: 0, text: "[1,2,3]\nnull\n" },
          { at: 3 * P, text: delivered(d.bReal) },
        ]),
      { via: "open", file: d.b },
    );
    expect(fx.out.slice(-2)).toEqual([`into: run ${fx.name} file delivered (source finder)`, "verdict: pass"]);
    expect(r.exit).toBe(0);
    expectInert(second);
  });

  it("IR-9 a file given through a symlink; the app logs the realpath: pass", async () => {
    const d = docs();
    const { fx, into, expectInert } = await liveRun();
    expect(d.link).not.toBe(d.bReal);
    const { r, second } = await into((f) => app(f, [{ at: P, text: delivered(d.bReal) }]), { via: "open", file: d.link });
    expect(second.calls[0].args.at(-1)).toBe(d.link);
    expect(fx.out.slice(-2)).toEqual([`into: run ${fx.name} file delivered (source finder)`, "verdict: pass"]);
    expect(r.exit).toBe(0);
    expectInert(second);
  });

  type Outcome = { row: string; via?: string; writes: (d: ReturnType<typeof docs>) => { at: number; text: string }[]; code?: number; verdict: string };
  const OUTCOMES: Outcome[] = [
    { row: "open delivered", via: "open", writes: (d) => [{ at: P, text: delivered(d.bReal) }], verdict: "verdict: pass" },
    { row: "exec delivered", writes: (d) => [{ at: 0, text: delivered(d.b, "single_instance") }], verdict: "verdict: pass" },
    { row: "open not delivered", via: "open", writes: () => CHECK_D.map((text) => ({ at: 0, text })), verdict: NOT_DELIVERED },
    { row: "exec not delivered", writes: () => [], verdict: NOT_DELIVERED },
    { row: "open exit 1 with a delivery line", via: "open", writes: (d) => [{ at: 0, text: delivered(d.bReal) }], code: 1, verdict: "verdict: fail — second process exited 1" },
    { row: "exec exit 1 with a delivery line", writes: (d) => [{ at: 0, text: delivered(d.bReal) }], code: 1, verdict: "verdict: fail — second process exited 1" },
  ];
  it.each(OUTCOMES)("IR-10 $row: the verdict, and no printed line or launcher.jsonl record carries the nonce", async ({ via, writes, code, verdict }) => {
    const d = docs();
    const { fx, into, expectInert } = await liveRun();
    const { r, second } = await into((f) => app(f, writes(d), code ?? 0), { file: d.b, ...(via ? { via } : {}) });
    expect(last(fx.out)).toBe(verdict);
    expect(r.exit).toBe(verdict === "verdict: pass" ? 0 : 1);
    for (const line of fx.out) expect(line).not.toContain(NONCE);
    expect(fs.readFileSync(fx.lay.launcherLog, "utf8")).not.toContain(NONCE);
    expectInert(second);
  });
});

describe("WI-R3 characterization: --into with no file", () => {
  it("IR-C1 direct exec with no file, child exits 0: nothing to deliver, the exit-0 pass is kept", async () => {
    const { fx, into, expectInert } = await liveRun();
    const { r, second } = await into((f) => app(f, []), {});
    expect(second.calls[0].args).toEqual([]);
    expect(fx.out.slice(-2)).toEqual([`into: run ${fx.name} second process exited 0`, "verdict: pass"]);
    expect(r.exit).toBe(0);
    expectInert(second);
  });
});
