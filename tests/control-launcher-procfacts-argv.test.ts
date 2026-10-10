// @vitest-environment node
/**
 * D82-WI-6 (M5): the verify-process scan counts a process by its `argv[0]`
 * (the `ps -o comm=` column), never by text in its later arguments.
 * Pure-parser cases over lines in the `pid=,comm=` format.
 * Matrix: `.claude/tdd-guardian/tests-20261010-103136.md`, D82-WI-6,
 * PF-M5-1..PF-M5-3, and finding 11 (PF-M5-0 row 2 printed `x`, so the law
 * is "membership depends only on argv[0]").
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { parseVerifyScan } from "../scripts/control/procFacts.mjs";
import { int, mulberry32, pick, str } from "./support/seededRandom";

const VERIFY = "/r/x/mdpro-verify.app/Contents/MacOS/tauri-app";
const VERIFY_SPACED = "/tmp/a b/mdpro-verify.app/Contents/MacOS/tauri-app";
const RELEASE = "/Applications/mdpro.app/Contents/MacOS/tauri-app";
const NEAR_MISSES = [
  "/r/x/mdpro-verify.app/Contents/MacOS/tauri-app2",
  "/r/x/mdpro-verify.app/Contents/MacOS/tauri-app.bak",
  "/r/x/mdpro-verify.app.bak/Contents/MacOS/tauri-app",
  "/r/x/xmdpro-verify.app/Contents/MacOS/tauri-app",
  "/r/x/mdpro-verify.app/Contents/MacOS/tauri-app/x",
];

describe("D82-WI-6 parseVerifyScan over pid=,comm= lines", () => {
  it("PF-M5-1 tools that merely mention the path are excluded; the real verify line is kept", () => {
    const text = ["  501 /usr/bin/grep", "  502 /usr/bin/vim", "  503 /bin/zsh", `  600 ${VERIFY}`, ""].join("\n");
    expect(parseVerifyScan(text)).toEqual([600]);
  });

  it("PF-M5-2 near misses and the release binary are excluded; a spaced verify path is included", () => {
    const rows = [...NEAR_MISSES, VERIFY_SPACED, RELEASE];
    const text = rows.map((exe, i) => `${700 + i} ${exe}`).join("\n");
    expect(parseVerifyScan(text)).toEqual([700 + NEAR_MISSES.length]);
  });

  it("PF-M5-2c the path must end at tauri-app: a component after a space is not the verify binary", () => {
    const text = [`4242 ${VERIFY} foo/bar`, `  600 ${VERIFY}`].join("\n");
    expect(parseVerifyScan(text)).toEqual([600]);
  });

  it("PF-M5-2b an unparsable line in comm format still makes the whole scan unknown", () => {
    expect(parseVerifyScan(`  600 ${VERIFY}\n/usr/bin/grep\n`)).toBe("unknown");
    expect(parseVerifyScan(`  600 ${VERIFY}\n601\n`)).toBe("unknown");
  });

  it("PF-M5-3 seeded 2026101003: rewriting every process's arguments never changes the scan", () => {
    const r = mulberry32(2026101003);
    const EXES = [VERIFY, VERIFY_SPACED, RELEASE, "/usr/bin/grep", ...NEAR_MISSES];
    const VERIFY_PATHS = new Set([VERIFY, VERIFY_SPACED]);
    const ALPHA = "abc -_/.'\" ";
    const args = (): string => (r() < 0.5 ? `${str(r, ALPHA, 0, 12)} ${VERIFY} ${str(r, ALPHA, 0, 6)}` : str(r, ALPHA, 0, 20));
    // `comm` carries argv[0] only, so the renderer drops args by construction.
    const render = (t: { pid: number; exe: string; args: string }[]): string =>
      t.map((p) => `${String(p.pid).padStart(5)} ${p.exe}`).join("\n");
    const violations: unknown[] = [];
    let verifyRows = 0;
    for (let i = 0; i < 300; i++) {
      const t = Array.from({ length: int(r, 1, 8) }, (_, k) => ({ pid: 1000 + k, exe: pick(r, EXES), args: args() }));
      const t2 = t.map((p) => ({ ...p, args: args() }));
      const oracle = t.filter((p) => VERIFY_PATHS.has(p.exe)).map((p) => p.pid);
      verifyRows += oracle.length;
      const a = parseVerifyScan(render(t));
      const b = parseVerifyScan(render(t2));
      if (JSON.stringify(a) !== JSON.stringify(b) || JSON.stringify(a) !== JSON.stringify(oracle)) {
        violations.push({ i, t, a, b, oracle });
      }
    }
    expect(verifyRows).toBeGreaterThan(50);
    expect(violations).toEqual([]);
  });
});
