/**
 * WI-3 — `src/App.tsx#loadPreferences` must APPLY the loaded theme without
 * PERSISTING it (matrix cases WI3-E, WI3-F).
 *
 * Background: `App.tsx:270` used to call `await setThemeMode(prefs.themeMode)`,
 * and `setThemeMode` writes through `preferencesService.setPreferences`. Startup
 * therefore wrote back the value it had just read — a redundant write every
 * launch, and with two windows a last-writer-wins clobber (B reads old, A writes
 * new, B writes old). Only the write is dropped; the apply half stays.
 *
 * ── SPEC LEVEL: BOTH CASES IN THIS FILE ARE BELOW LEVEL 6 ────────────────────
 *
 * Every assertion here is SOURCE-TEXT INSPECTION. Nothing in this file renders
 * App, runs the effect, or observes the theme store. The matrix records this
 * unit as having NO LAW — a call-site fence has no conserved quantity, no round
 * trip, and no idempotent operation; it asserts the shape of a file. It is a
 * SUPPLEMENT to the executable cases in
 * `tests/use-theme-apply-and-persist.test.ts` (WI3-A/B/C) and to the manual
 * two-window QA, and must never be read as a substitute for either.
 *
 * The fence carries more weight than a fence should, for a reason worth stating:
 * no test in this repo renders `App`. The only other App-targeted file,
 * `tests/large-document-guard-call-site.test.ts`, is itself a source fence. So
 * for `loadPreferences` specifically, source text is the only automated signal
 * available.
 *
 * ── Residual risk these cases do NOT close ───────────────────────────────────
 *
 *   - A `setPreferences` call OUTSIDE the sliced body that still writes
 *     `themeMode` at launch — e.g. from a second effect — satisfies this fence.
 *   - A write routed through a helper defined elsewhere (`persistTheme(mode)`)
 *     satisfies it: the fence matches spellings, not data flow.
 *   - An `applyThemeMode(prefs.themeMode)` call inside a branch that never
 *     executes satisfies it.
 *   - A call whose effect is overwritten by a later effect satisfies it.
 *   - Ordering relative to a throwing `await` is not observed here at all.
 *   - WI3-F's ordering claim has no possible paired behavioural test: it is about
 *     statement order inside an effect and the repo has no lane that renders
 *     App. Recorded as a gap, not papered over.
 *
 * The body is SLICED before any `indexOf`, and that is mandatory rather than
 * tidy: App.tsx contains six `finally` blocks and more than one `setThemeMode`
 * reference (the user-initiated `onThemeModeChange` at ~line 1019 must KEEP
 * writing), so a whole-file `indexOf` would be vacuous in both directions.
 * Every `indexOf` is guarded against `-1` before any ordering comparison,
 * because `-1 < anyIndex` is true and an unguarded ordering assertion goes
 * vacuously green in exactly the failure case it is there to catch.
 *
 * ── CORRECTION to the matrix (recorded, not quietly applied) ─────────────────
 *
 * Matrix WI3-E specifies `expect(body).not.toMatch(/setPreferences/)`. That
 * assertion CANNOT PASS against correct code: the body's own
 * `setPreferencesLoaded(true)` — which WI3-E separately *requires* to be present
 * — contains the substring `setPreferences`. The intent (forbid the write
 * *capability*, not merely four spellings) is preserved by matching a call:
 * `/setPreferences\s*\(/`, which rejects `setPreferences({ … })` and
 * `preferencesService.setPreferences(…)` while admitting
 * `setPreferencesLoaded(`. `preferencesService` itself is deliberately NOT
 * forbidden — the body must keep calling `getPreferences()`.
 */

import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";

// Anchor on expect.getState().testPath, NOT import.meta.url: under Vite's
// transform import.meta.url is not a file:// URL and fileURLToPath throws.
function readAppSrc(): string {
  const testPath = expect.getState().testPath;
  if (!testPath) throw new Error("testPath unavailable");
  return fs.readFileSync(path.resolve(path.dirname(testPath), "../src/App.tsx"), "utf-8");
}

const BODY_START = "const loadPreferences";
const BODY_END = "void loadPreferences()";

function sliceLoadPreferencesBody(src: string): string {
  const start = src.indexOf(BODY_START);
  const end = src.indexOf(BODY_END);
  expect(start, `"${BODY_START}" not found in App.tsx`).toBeGreaterThan(-1);
  expect(end, `"${BODY_END}" not found after "${BODY_START}"`).toBeGreaterThan(start);
  return src.slice(start, end);
}

describe("WI-3: App.tsx theme hydration call site (source-text, below Level 6)", () => {
  it("WI3-E: loadPreferences applies the loaded theme and persists nothing", () => {
    const body = sliceLoadPreferencesBody(readAppSrc());

    // 1. The hydration write is gone, by its own name.
    expect(body.indexOf("setThemeMode")).toBe(-1);

    // 2. And by any other spelling. Without this, writing
    //    `void preferencesService.setPreferences({ themeMode: prefs.themeMode })`
    //    straight into the hydration body reinstates the redundant write and the
    //    two-window clobber while satisfying every other assertion in the
    //    matrix — no case renders App, so nothing else would see it.
    expect(body).not.toMatch(/setPreferences\s*\(/);

    // 3. The apply half survives, AND carries the loaded value. `toContain(
    //    "applyThemeMode")` alone is satisfied by `applyThemeMode("system")`,
    //    which would hydrate every launch to System and silently discard the
    //    user's saved mode. The argument is the whole point of the call.
    expect(body).toMatch(/applyThemeMode\(\s*prefs\.themeMode\s*\)/);

    // 4. The loaded flag still fires from `finally`, i.e. on every path
    //    including the throwing one.
    const finallyIdx = body.indexOf("finally");
    const setterIdx = body.indexOf("setPreferencesLoaded(true)");
    expect(finallyIdx).toBeGreaterThan(-1);
    expect(setterIdx).toBeGreaterThan(-1);
    expect(finallyIdx).toBeLessThan(setterIdx);
  });

  it("WI3-F: removing the await did not reorder the rest of the hydration body", () => {
    const src = readAppSrc();
    const body = sliceLoadPreferencesBody(src);

    const ordered = [
      "applyWindowState",
      "applyThemeMode",
      "prefs.editor",
      "prefs.appearance",
      "prefs.markdown",
    ];

    const indices = ordered.map((needle) => {
      const idx = body.indexOf(needle);
      expect(idx, `"${needle}" is missing from the loadPreferences body`).toBeGreaterThan(-1);
      return idx;
    });

    for (let i = 1; i < indices.length; i += 1) {
      expect(
        indices[i - 1],
        `"${ordered[i - 1]}" must still precede "${ordered[i]}"`,
      ).toBeLessThan(indices[i]);
    }

    // The effect's dependency array must match the call site it no longer has.
    const end = src.indexOf(BODY_END);
    const depsEnd = src.indexOf("]);", end);
    expect(depsEnd, "the effect's dependency array was not found").toBeGreaterThan(end);
    const deps = src.slice(end, depsEnd);
    expect(deps).not.toContain("setThemeMode");
    expect(deps).toContain("applyThemeMode");
  });
});
