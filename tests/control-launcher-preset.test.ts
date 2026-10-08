// @vitest-environment node
/**
 * ADR-0047 WI-003 WI-2: the launcher's preferences preset — the committed
 * template `scripts/control/presets/verify-preferences.json` (decision D3) and
 * `scripts/control/preset.mjs` (`buildPreferences`, `writePreferences`).
 * Matrix: `.claude/tdd-guardian/tests-20261008-144444.md`, WI-2, P-04..P-07.
 * P-01..P-03 are the Rust oracle in
 * `src-tauri/src/models/preferences_verify_preset_tests.rs`.
 *
 * Required keys, the error message and the modes are pinned here as literals.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildPreferences,
  PRESET_TEMPLATE,
  writePreferences,
  // @ts-expect-error -- plain ESM script, no .d.ts by design
} from "../scripts/control/preset.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { layout, runName } from "../scripts/control/runDir.mjs";

type Json = Record<string, unknown>;

const REPO = path.resolve(__dirname, "..");
const TEMPLATE_PATH = path.join(REPO, "scripts/control/presets/verify-preferences.json");
const CONTRACT_PATH = path.join(REPO, "tests/fixtures/preferences-contract.json");
const REQUIRED = [
  "themeMode",
  "autoSaveInterval",
  "defaultViewMode",
  "showSidebar",
  "enableScrollSync",
  "recentFiles",
  "windowState",
];
const VIEW_MODE_ERROR = 'viewMode must be "source" or "wysiwyg"';
const VIEW_KEYS = ["defaultViewMode", "lastViewMode"];

function readJson(p: string): Json {
  return JSON.parse(fs.readFileSync(p, "utf8")) as Json;
}

function isPlainObject(v: unknown): v is Json {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function deepFreeze<T>(o: T): T {
  if (isPlainObject(o) || Array.isArray(o)) {
    for (const v of Object.values(o as object)) deepFreeze(v);
    Object.freeze(o);
  }
  return o;
}

function contract(): Json {
  const raw = readJson(CONTRACT_PATH);
  return Object.fromEntries(Object.entries(raw).filter(([k]) => !k.startsWith("$")));
}

describe("P-04 template key graph vs the preferences contract", () => {
  const template = readJson(TEMPLATE_PATH);
  const doc = contract();

  it("has every required top-level key", () => {
    const missing = REQUIRED.filter((k) => !(k in template));
    expect(missing).toEqual([]);
  });

  it("every nested object carries exactly the contract's key set", () => {
    const nested = Object.keys(template).filter((k) => isPlainObject(template[k]));
    expect(nested.sort()).toEqual(["logging", "markdown", "windowState"]);
    const mismatches: Record<string, { missing: string[]; extra: string[] }> = {};
    for (const key of nested) {
      const want = Object.keys(doc[key] as Json);
      const got = Object.keys(template[key] as Json);
      const missing = want.filter((k) => !got.includes(k));
      const extra = got.filter((k) => !want.includes(k));
      if (missing.length || extra.length) mismatches[key] = { missing, extra };
    }
    expect(mismatches).toEqual({});
  });

  it("has no mcp or autoSave key, logging on at debug, autoSaveInterval 5", () => {
    expect("mcp" in template).toBe(false);
    expect("autoSave" in template).toBe(false);
    expect(template.logging).toEqual({ enabled: true, level: "debug" });
    expect(template.autoSaveInterval).toBe(5);
  });

  it("PRESET_TEMPLATE is the committed file, not a copy", () => {
    expect(PRESET_TEMPLATE).toEqual(template);
  });
});

describe("P-05 accepted view modes and the restricted-difference invariant", () => {
  it("each accepted mode changes only the two view-mode keys, template untouched", () => {
    deepFreeze(PRESET_TEMPLATE);
    const before = JSON.stringify(PRESET_TEMPLATE);
    const results: Json[] = [];
    for (const v of ["source", "wysiwyg"]) {
      const out = buildPreferences({ viewMode: v }) as Json;
      expect(out.defaultViewMode).toBe(v);
      expect(out.lastViewMode).toBe(v);
      const tpl = PRESET_TEMPLATE as Json;
      const keys = new Set([...Object.keys(out), ...Object.keys(tpl)]);
      const differing = [...keys].filter(
        (k) => JSON.stringify(out[k]) !== JSON.stringify(tpl[k]),
      );
      expect(differing.every((k) => VIEW_KEYS.includes(k))).toBe(true);
      for (const k of keys) if (!VIEW_KEYS.includes(k)) expect(out[k]).toEqual(tpl[k]);
      results.push(out);
    }
    expect(results[0]).not.toBe(results[1]);
    expect(results[0].windowState).not.toBe(results[1].windowState);
    expect(JSON.stringify(PRESET_TEMPLATE)).toBe(before);
  });
});

describe("P-06 any other view mode is refused", () => {
  const bad: unknown[] = [
    "split",
    "editor-only",
    "preview-only",
    "Source",
    "",
    undefined,
    null,
    5,
  ];
  for (const v of bad) {
    it(`refuses ${JSON.stringify(v) ?? "undefined"}`, () => {
      let message: string | undefined;
      try {
        buildPreferences({ viewMode: v });
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      expect(message).toBe(VIEW_MODE_ERROR);
    });
  }
});

describe("P-07 writePreferences: modes, exclusivity, round-trip", () => {
  const tmps: string[] = [];
  afterEach(() => {
    for (const d of tmps.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  it("writes 0700 dir + 0600 file, round-trips, and refuses a second write with EEXIST", async () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "mdpro-preset-"));
    tmps.push(parent);
    const lay = layout(parent, runName(Buffer.alloc(16, 7))) as Record<string, string>;
    fs.mkdirSync(lay.runDir, { mode: 0o700 });

    await writePreferences(lay, { viewMode: "source" });
    expect(fs.statSync(lay.prefsDir).mode & 0o777).toBe(0o700);
    expect(fs.statSync(lay.prefs).mode & 0o777).toBe(0o600);
    expect(JSON.parse(fs.readFileSync(lay.prefs, "utf8"))).toEqual(
      buildPreferences({ viewMode: "source" }),
    );

    const bytes = fs.readFileSync(lay.prefs);
    await expect(writePreferences(lay, { viewMode: "wysiwyg" })).rejects.toMatchObject({
      code: "EEXIST",
    });
    expect(fs.readFileSync(lay.prefs).equals(bytes)).toBe(true);
  });
});
