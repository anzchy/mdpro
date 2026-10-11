// @vitest-environment node
/**
 * D133-WI-2: `drag.swift` releases what it holds on every exit path, and its
 * validator refuses a plan that could hold the button or ⌥ past the end.
 *
 * Static checks only: the executor posts real HID events, so it is never run
 * here. Its behaviour on hostile stdin is shown by hand on a compiled binary
 * (the D133 report). The cap-sync case is the one that guards a real drift:
 * the Swift cap must equal `MAX_PLAN_MS` from dragPlan.mjs.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { MAX_PLAN_MS } from "../scripts/device/dragPlan.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = (): string => fs.readFileSync(path.join(REPO_ROOT, "scripts/device/drag.swift"), "utf8");

/** The text of a top-level Swift `func name(...)` up to its closing brace at column 0. */
function funcBody(s: string, name: string): string {
  const m = new RegExp(`^func ${name}\\b[\\s\\S]*?^\\}`, "m").exec(s);
  if (!m) throw new Error(`func ${name} not found in drag.swift`);
  return m[0];
}

describe("drag.swift — cap mirrors dragPlan.mjs", () => {
  it("declares exactly one maxPlanMs constant equal to MAX_PLAN_MS", () => {
    const matches = [...src().matchAll(/\blet maxPlanMs\s*=\s*([\d_]+)\b/g)];
    expect(matches).toHaveLength(1);
    expect(Number(matches[0][1].replaceAll("_", ""))).toBe(MAX_PLAN_MS);
  });
});

describe("drag.swift — validator", () => {
  const AX = "guard AXIsProcessTrusted()";

  it("refuses waits over the cap, before the Accessibility check and before any post", () => {
    const s = src();
    const msg = 'fail("drag: malformed plan: waits exceed the \\(maxPlanMs) ms cap", 1)';
    expect(s).toContain(msg);
    expect(s.indexOf(msg)).toBeLessThan(s.indexOf(AX));
    expect(s.indexOf(msg)).toBeLessThan(s.indexOf(".post(tap:"));
  });

  it("refuses an unpaired or misnested press, before the Accessibility check and before any post", () => {
    const s = src();
    const msg = 'fail("drag: malformed plan: \\(event.type) out of order (unpaired or misnested press)", 1)';
    const end = 'fail("drag: malformed plan: a press has no matching release", 1)';
    for (const m of [msg, end]) {
      expect(s).toContain(m);
      expect(s.indexOf(m)).toBeLessThan(s.indexOf(AX));
      expect(s.indexOf(m)).toBeLessThan(s.indexOf(".post(tap:"));
    }
  });

  it("no longer converts an unchecked ms straight into useconds_t", () => {
    expect(src()).not.toMatch(/useconds_t\(\(event\.ms \?\? 0\) \* 1000\)/);
  });
});

describe("drag.swift — releases on every exit path", () => {
  it("fail() releases what is held before it exits", () => {
    const body = funcBody(src(), "fail");
    expect(body).toContain("releaseHeld()");
    expect(body.indexOf("releaseHeld()")).toBeLessThan(body.indexOf("exit("));
  });

  it("releaseHeld() posts a leftMouseUp and an Option key-up", () => {
    const body = funcBody(src(), "releaseHeld");
    expect(body).toMatch(/\.leftMouseUp/);
    expect(body).toMatch(/virtualKey:\s*58,\s*keyDown:\s*false/);
    expect(body).toMatch(/\.post\(tap: \.cghidEventTap\)/);
  });

  it("handles SIGINT, SIGTERM and SIGHUP with dispatch signal sources that release, then exit 128 + signo", () => {
    const s = src();
    for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) expect(s).toContain(sig);
    expect(s).toMatch(/DispatchSource\.makeSignalSource\(signal:/);
    expect(s).toMatch(/signal\(\w+, SIG_IGN\)/);
    const handler = /setEventHandler\s*\{[\s\S]*?\}/.exec(s)?.[0] ?? "";
    expect(handler).toContain("releaseHeld()");
    expect(handler).toMatch(/exit\(128 \+ /);
  });
});
