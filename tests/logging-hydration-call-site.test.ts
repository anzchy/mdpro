// @vitest-environment node
/**
 * WI-3 — App.tsx must hydrate logging settings via loggingService.hydrateSettings(),
 * not from the preference object.
 *
 * Background: App.tsx hydrated the logging store from `prefs.logging`. In the
 * shipping desktop app that preference object is a browser-mode constant that
 * never reached Rust, so logging was silently governed by a default rather than
 * by the user's real settings. WI-2 added `loggingService.hydrateSettings()`,
 * which reads the real settings and writes the store. WI-3 switches the call
 * site and removes App's handle on the logging store entirely.
 *
 * ── SPEC LEVEL: ALL THREE CASES IN THIS FILE ARE BELOW LEVEL 6 ───────────────
 *
 * Every assertion here is SOURCE-TEXT INSPECTION, not behavioral execution.
 * Nothing in this file renders App, runs the effect, or observes the logging
 * store. These cases are SUPPLEMENTS to WI-2's executable cases and must never
 * be read as proving that hydration actually works.
 *
 * Residual risk these cases do NOT close:
 *   - A `hydrateSettings()` call placed inside a branch that never executes
 *     still satisfies WI-3-A.
 *   - A `hydrateSettings()` call whose result is overwritten by a later effect
 *     still satisfies WI-3-A.
 *   - Ordering relative to a throwing `await` is not observed here at all.
 *
 * Where the behavioral weight actually sits:
 *   - tests/logging-hydrate-settings.test.ts — WI-2's executable cases. WI-2-F
 *     in particular proves hydrateSettings() governs real log emission, and
 *     WI-2-D proves it never rejects.
 *   - End-to-end verification that the shipping app hydrates from real settings
 *     is the MANUAL QA step. It is not this file, and this file passing is not
 *     a substitute for it.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

// Anchor on expect.getState().testPath, NOT import.meta.url: under Vite's
// transform import.meta.url is not a file:// URL and fileURLToPath throws
// "TypeError: The URL must be of scheme file".
function readAppSrc(): string {
  const testPath = expect.getState().testPath;
  if (!testPath) throw new Error("testPath unavailable");
  return fs.readFileSync(
    path.resolve(path.dirname(testPath), "../src/App.tsx"),
    "utf-8",
  );
}

describe("WI-3: App.tsx logging hydration call site (source-text, below Level 6)", () => {
  it("WI-3-A: hydrates via hydrateSettings and no longer reads prefs.logging", () => {
    const src = readAppSrc();
    expect(src).not.toContain("prefs.logging");
    expect(src).toContain("hydrateSettings");
  });

  it("WI-3-B: setPreferencesLoaded(true) still fires from the finally block on every path", () => {
    const src = readAppSrc();

    // Slice the loadPreferences body first. App.tsx has SIX `finally` blocks;
    // a whole-file index comparison would pass only by the accident that the
    // relevant one happens to be first, and would go vacuous the moment any
    // try/finally is inserted above it.
    const start = src.indexOf("const loadPreferences");
    const end = src.indexOf("void loadPreferences()");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);

    const body = src.slice(start, end);
    const finallyIdx = body.indexOf("finally");
    const setterIdx = body.indexOf("setPreferencesLoaded(true)");

    // These two -1 guards are mandatory, not defensive noise: indexOf returns
    // -1 on absence and -1 is less than any real index, so a bare ordering
    // assertion would be vacuously green in exactly the failure case it
    // guards — delete the `finally` and the setter would still "pass" while
    // sitting on the success path only.
    expect(finallyIdx).toBeGreaterThan(-1);
    expect(setterIdx).toBeGreaterThan(-1);
    expect(finallyIdx).toBeLessThan(setterIdx);
  });

  it("WI-3-C: App holds no handle on the logging store by any spelling", () => {
    const src = readAppSrc();

    // WI-3-A alone is defeated by a fully idiomatic restoration of the bug:
    //   const { logging } = prefs;                 // no "prefs.logging" substring
    //   await loggingService.hydrateSettings();    // WI-3-A satisfied
    //   if (logging) useLoggingStore.getState().setSettings(logging);  // bug back
    // Forbidding the handle outright upgrades the guard from "App avoids four
    // spellings" to "App cannot write logging settings by any spelling".
    //
    // Deliberately NOT asserting absence of the substring "setSettings":
    // `setSettingsOpen` (unrelated settings-DIALOG state) contains it, so that
    // assertion would fail against correct code and would be "fixed" by
    // renaming perfectly good state. `useLoggingStore` has no such collision.
    expect(src).not.toContain("useLoggingStore");
  });
});
