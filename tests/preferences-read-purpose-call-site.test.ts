// @vitest-environment node
/**
 * D24 WI-4 — every `getPreferences` caller in `src/` passes its own closed-enum
 * purpose. Matrix `.claude/tdd-guardian/tests-20261007-171405.md` PRL-06,
 * PRL-07, PRL-08.
 *
 * ── SPEC LEVEL: EVERY CASE IN THIS FILE IS BELOW LEVEL 6 ─────────────────────
 *
 * Source-text inspection only. Nothing here renders App, a settings panel or a
 * hook. It is a SUPPLEMENT to the executable cases in
 * `tests/preferences-read-log.test.ts` (PRL-01..04) and
 * `tests/preferences-read-log-hook.test.ts` (PRL-05), and to the device run
 * (M-5). No law: a call-site fence asserts the shape of files.
 *
 * Why it exists at all:
 *   - tsc rejects a MISSING purpose only if the parameter is required, and
 *     `tsconfig` `include: ["src"]` keeps tests out of tsc, so no unit-lane test
 *     can observe that diagnostic (F-5). PRL-08 pins the two preconditions
 *     (a required, non-defaulted, closed parameter; no argument-less caller in
 *     `src/`) under which a green `pnpm build` IS that proof.
 *   - tsc accepts a WRONG purpose: every caller passing `"app_hydrate"` would
 *     compile and silently break GA-12 counting. PRL-07 pins each caller's own
 *     literal.
 *
 * Comments are stripped before matching (F-12): doc comments in `src/` may
 * mention `getPreferences()` in prose. The stripper is self-checked, and the
 * ≥ 11 caller count proves it did not swallow real calls.
 *
 * Residual risk: a fence matches spellings, not data flow. A call inside a
 * branch that never runs, or a purpose routed through a variable, is not seen.
 * Every `indexOf` is guarded against -1.
 */
import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";

const PURPOSES = [
  "app_hydrate",
  "view_mode_startup_settle",
  "view_mode_restore_on_close",
  "save_reformat_check",
  "settings_dialog",
  "settings_appearance",
  "settings_general",
  "settings_markdown",
  "settings_editor",
  "settings_export",
  "settings_image",
  "settings_shortcuts",
] as const;

// Anchor on expect.getState().testPath, NOT import.meta.url (Vite transform).
function repoRoot(): string {
  const testPath = expect.getState().testPath;
  if (!testPath) throw new Error("testPath unavailable");
  return path.resolve(path.dirname(testPath), "..");
}

const readSrc = (rel: string) => fs.readFileSync(path.join(repoRoot(), rel), "utf-8");

function strip(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

/** Every `.ts` / `.tsx` file under `src/`, as repo-relative POSIX paths. */
function walkSrc(): string[] {
  const root = repoRoot();
  const out: string[] = [];
  const visit = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (/\.(ts|tsx)$/.test(entry.name)) {
        out.push(path.relative(root, full).split(path.sep).join("/"));
      }
    }
  };
  visit(path.join(root, "src"));
  return out;
}

const ARGLESS = /getPreferences\(\s*\)/;
const callWith = (literal: string) =>
  new RegExp(`getPreferences\\(\\s*"${literal}"\\s*\\)`);

describe("PRL-06: App.tsx loadPreferences reads with app_hydrate, exactly once", () => {
  it("the loadPreferences slice calls getPreferences(\"app_hydrate\") once and never argument-less", () => {
    const src = readSrc("src/App.tsx");
    const start = src.indexOf("const loadPreferences");
    const end = src.indexOf("void loadPreferences()");
    expect(start, "\"const loadPreferences\" not found").toBeGreaterThan(-1);
    expect(end, "\"void loadPreferences()\" not found after it").toBeGreaterThan(start);
    const slice = src.slice(start, end);

    expect(slice.match(/getPreferences\(\s*"app_hydrate"\s*\)/g) ?? []).toHaveLength(1);
    expect(slice).not.toMatch(ARGLESS);
  });
});

describe("PRL-07: each caller passes its own purpose", () => {
  const TABLE: Array<[string, string[]]> = [
    // D70: the save body moved verbatim from hooks/useDocument.ts into the queued
    // save service; the call site and its purpose are unchanged.
    ["src/services/documentSave.ts", ["save_reformat_check"]],
    ["src/components/common/SettingsDialog.tsx", ["settings_dialog"]],
    ["src/components/common/settings/AppearanceSettings.tsx", ["settings_appearance"]],
    ["src/components/common/settings/GeneralSettings.tsx", ["settings_general"]],
    ["src/components/common/settings/MarkdownSettings.tsx", ["settings_markdown"]],
    ["src/components/common/settings/EditorSettings.tsx", ["settings_editor"]],
    ["src/components/common/settings/ExportSettings.tsx", ["settings_export"]],
    ["src/components/common/settings/ImageSettings.tsx", ["settings_image"]],
    ["src/components/common/settings/KeyboardShortcutsSettings.tsx", ["settings_shortcuts"]],
    [
      "src/hooks/useLastViewModePersistence.ts",
      ["view_mode_startup_settle", "view_mode_restore_on_close"],
    ],
  ];

  it.each(TABLE)("%s", (rel, literals) => {
    const text = strip(readSrc(rel));
    for (const literal of literals) {
      expect(text, `${rel} must call getPreferences("${literal}")`).toMatch(callWith(literal));
    }
    expect(text).not.toMatch(ARGLESS);
  });

  it("each of the 12 purposes is passed by at least one getPreferences call in src/", () => {
    const texts = walkSrc().map((rel) => strip(readSrc(rel)));
    const unused = PURPOSES.filter((p) => !texts.some((t) => callWith(p).test(t)));
    expect(unused).toEqual([]);
  });
});

describe("PRL-08: the purpose parameter is required and closed; no src/ caller omits it", () => {
  it("signature, no argument-less caller, non-vacuous walk, closed type", () => {
    // Stripper self-check: a commented mention vanishes, a real call survives.
    const probe = strip("// x.getPreferences()\nfoo.getPreferences()");
    expect(probe.match(/getPreferences\(\s*\)/g) ?? []).toHaveLength(1);

    const files = walkSrc();
    expect(files).toContain("src/services/preferencesService.ts");
    expect(files).toContain("src/App.tsx");
    const stripped = new Map(files.map((rel) => [rel, strip(readSrc(rel))]));

    // Signature: required, not optional, not defaulted.
    const service = stripped.get("src/services/preferencesService.ts") ?? "";
    expect(service).toMatch(/getPreferences\(\s*purpose:\s*PreferenceReadPurpose\s*\)/);
    expect(service).not.toMatch(/purpose\s*\?\s*:|purpose:\s*PreferenceReadPurpose\s*=/);

    // No argument-less caller anywhere in src/.
    const offenders = files.filter((rel) => ARGLESS.test(stripped.get(rel) ?? ""));
    expect(offenders, `argument-less getPreferences() in: ${offenders.join(", ")}`).toEqual([]);

    // Non-vacuity: the 11 HEAD callers are still seen after stripping.
    const callers = files.filter(
      (rel) =>
        rel !== "src/services/preferencesService.ts" &&
        (stripped.get(rel) ?? "").includes("getPreferences("),
    );
    expect(callers.length).toBeGreaterThanOrEqual(11);

    // Closed type: exactly one declaration, no widening, all 12 literals.
    const declarers = files.filter((rel) =>
      (stripped.get(rel) ?? "").includes("type PreferenceReadPurpose ="),
    );
    expect(declarers).toHaveLength(1);
    const declText = stripped.get(declarers[0]) ?? "";
    const declStart = declText.indexOf("type PreferenceReadPurpose =");
    expect(declStart).toBeGreaterThan(-1);
    const declEnd = declText.indexOf(";", declStart);
    expect(declEnd).toBeGreaterThan(declStart);
    const decl = declText.slice(declStart, declEnd);
    expect(decl).not.toMatch(/\bundefined\b|\bnull\b|\bstring\b/);
    const missing = PURPOSES.filter((p) => !decl.includes(`"${p}"`));
    expect(missing).toEqual([]);
  });
});
