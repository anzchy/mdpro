/**
 * The `launch --into` fixture for the D82-WI-3 tests: a live run R from a real
 * (faked-boundary) launch, a second-process spawn per `--into`, the fake app
 * that appends delivery lines to R's real app log on the fake clock, and the
 * inertness check (nothing signalled, run identity untouched, no nonce).
 * Same shape as the `liveRun` in `control-launcher-into-delivery.test.ts`,
 * which is left as recorded.
 */
import fs from "node:fs";
import path from "node:path";
import { expect } from "vitest";
import { launchFixture, launcherText, NONCE, type Fixture } from "./launchHarness";
import { fakeSpawn, type SpawnScript } from "./launcherFakes";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { run } from "../../scripts/control/launch.mjs";

export type Result = { exit: number; lines: string[] };

/** One JSONL line the way `logger::log_event` writes it. */
export const entry = (event: string, status: string, context: Record<string, unknown>) =>
  `${JSON.stringify({ timestamp: "2026-10-10T00:00:00Z", level: "info", event, status, context })}\n`;
export const delivered = (filePath: string, source = "finder") => entry("file.open.external", "success", { filePath, source });

export const appendText = (file: string, text: string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, text);
};

/** The bytes of every run-identity record. */
export const records = (fx: Fixture) =>
  [path.join(fx.parent, ".lock"), fx.lay.ownerJson, fx.lay.instanceJson, fx.lay.launchJson].map((p) => fs.readFileSync(p, "utf8"));

/**
 * A second process that appends `writes` to R's app log, each `at` ms after
 * the spawn (0 = during the spawn call), records the spawn time in `seen.t0`,
 * and exits `code`.
 */
export const app =
  (fx: Fixture, writes: { at: number; text: string }[], code = 0): SpawnScript =>
  (call, child) => {
    const t0 = fx.clock.now();
    call.seen.t0 = t0;
    for (const w of writes) {
      if (w.at === 0) appendText(fx.lay.appLog, w.text);
      else fx.clock.at(t0 + w.at, () => appendText(fx.lay.appLog, w.text));
    }
    child.exitSoon(code);
  };

/** A live run R; `into` runs `--into R` with a fresh second-process spawn. `cleanups` gets the fixture's cleanup. */
export async function liveRun(cleanups: (() => void)[]) {
  const fx = launchFixture();
  cleanups.push(fx.cleanup);
  const first: Result = await run({ file: "/tmp/f.md" }, fx.deps);
  expect(first.exit).toBe(0);
  fx.out.length = 0;
  const before = records(fx);
  const into = async (script: SpawnScript, args: Record<string, unknown>) => {
    const second = fakeSpawn(script, [6000]);
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

/** A tmp doc to hand to `--into`; its realpath is what the fake app logs. */
export function doc(cleanups: (() => void)[]) {
  const dir = fs.mkdtempSync("/tmp/iw");
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "b.md");
  fs.writeFileSync(file, "# b\n");
  return { file, real: fs.realpathSync(file) };
}
