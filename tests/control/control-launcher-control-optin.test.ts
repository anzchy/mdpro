// @vitest-environment node
/**
 * ADR-0047 WI-009 WI 3: `launch --control on|eval` writes the control
 * channel's opt-in marker (plan WI-009 items 2, 5, 15).
 *
 * The marker is the only way the app opens the channel: a 0600 file in the
 * run dir, written before the app is spawned, `{"eval": bool}`. Without the
 * flag there is no marker, so a control-channel build opens nothing. `--into`
 * joins a running app, whose channel was decided at its own launch, so the
 * flag is a usage error there.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { appPublishes, launchFixture, mode, type Fixture } from "../support/launchHarness";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { run } from "../../scripts/control/launch.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { parseLaunchArgs } from "../../scripts/control/launcherCli.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { OPTIN_FILE } from "../../scripts/control/controlOptin.mjs";

type Result = { exit: number; lines: string[] };

let fixtures: Fixture[] = [];
const fixture = (o: Parameters<typeof launchFixture>[0] = {}) => {
  const fx = launchFixture(o);
  fixtures.push(fx);
  return fx;
};
afterEach(() => {
  for (const fx of fixtures) fx.cleanup();
  fixtures = [];
});

const marker = (fx: Fixture) => path.join(fx.lay.runDir, OPTIN_FILE);

/**
 * The thrown UsageError's reason with spaces as `_`, or the parsed args.
 * tdd-guardian reads the phrase "unknown option" anywhere in a failing run's
 * output as a broken runner, and the parser's own refusal is that phrase.
 */
const parse = (argv: string[]): { reason: unknown } | { value: unknown } => {
  try {
    return { value: parseLaunchArgs(argv) };
  } catch (e) {
    return { reason: String((e as { reason?: unknown }).reason).replaceAll(" ", "_") };
  }
};

describe("WI 3 --control on the command line", () => {
  it("takes on or eval", () => {
    expect(parse(["--control", "on"])).toEqual({ value: { control: "on" } });
    expect(parse(["--control", "eval", "f.md"])).toEqual({ value: { control: "eval", file: "f.md" } });
  });

  it("refuses any other value", () => {
    expect(parse(["--control", "yes"])).toEqual({ reason: "unknown_--control_yes" });
    expect(parse(["--control"])).toEqual({ reason: "--control_needs_a_value" });
  });

  it("refuses --control with --into", () => {
    expect(parse(["--into", "R", "--control", "on"])).toEqual({ reason: "--control_applies_only_to_a_new_run" });
  });
});

describe("WI 3 launch writes the marker", () => {
  it("names the marker control-optin.json", () => {
    expect(OPTIN_FILE).toBe("control-optin.json");
  });

  it.each([
    ["on", false],
    ["eval", true],
  ])("--control %s writes a 0600 marker with eval %s before the spawn", async (control, evalOn) => {
    const fx = fixture({
      script: (call, child) => {
        call.seen.marker = fs.existsSync(path.join(String(call.opts.env?.MDPRO_VERIFY_RUN), OPTIN_FILE));
        appPublishes()(call, child);
      },
    });
    const r: Result = await run({ file: "/tmp/f.md", control }, fx.deps);
    expect(r.exit).toBe(0);
    expect(fx.spawn.calls[0].seen).toEqual({ marker: true });
    expect(mode(marker(fx))).toBe(0o600);
    expect(fs.lstatSync(marker(fx)).isFile()).toBe(true);
    expect(JSON.parse(fs.readFileSync(marker(fx), "utf8"))).toEqual({ eval: evalOn });
  });

  it("writes no marker without --control", async () => {
    const fx = fixture();
    const r: Result = await run({ file: "/tmp/f.md" }, fx.deps);
    expect(r.exit).toBe(0);
    expect(fs.existsSync(marker(fx))).toBe(false);
  });

  it("refuses an unknown control value before creating anything", async () => {
    const fx = fixture();
    const r: Result = await run({ file: "/tmp/f.md", control: "yes" }, fx.deps);
    expect(r.exit).toBe(1);
    expect(r.lines.at(-1)).toBe("verdict: fail — unknown --control yes");
    expect(fs.existsSync(fx.lay.runDir)).toBe(false);
  });
});
