// @vitest-environment node
/**
 * WI-8 (ADR-0031 step 4) — the cross-language contract-parity fence, TS half.
 *
 * Covers matrix cases WI8-C, WI8-D and WI8-F of
 * `.claude/tdd-guardian/tests-20260923-152800.md`.
 *
 * **Why this exists.** ADR-0031 declines `#[serde(deny_unknown_fields)]`, so
 * nothing in the running system will ever report a drift between the Rust
 * `UserPreferences` and this one. A field added to one side is silently
 * ignored by the other and `#[serde(default)]` manufactures a replacement.
 *
 * **The mechanism is the shared file, not the assertion.** Two independent
 * same-language round trips cannot detect cross-language disagreement. Both
 * lanes read the same bytes: `tests/fixtures/preferences-contract.json`. The
 * Rust half is `src-tauri/src/models/preferences_wi8_tests.rs` (WI8-A, WI8-B,
 * WI8-G); the shortcut-value half is `preferences_wi7_tests.rs::wi7_h_…`.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isTauri } from "@tauri-apps/api/core";

import type { ViewMode } from "../src/types/editor";
import {
  DEFAULT_KEYBOARD_SHORTCUTS,
  DEFAULT_MCP_CONFIG,
  type KeyboardShortcuts,
  type McpConfig,
  type WindowGeometry,
} from "../src/types/preferences";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

function readContractFixture(): Record<string, unknown> {
  // Anchored on the running test file's own absolute path, so resolution does
  // not depend on vitest's cwd — the idiom at
  // `tests/preferences-logging-default.test.ts:153-158`.
  const testPath = expect.getState().testPath;
  expect(testPath).toBeTruthy();
  const fixturePath = resolve(dirname(testPath as string), "fixtures/preferences-contract.json");
  return JSON.parse(readFileSync(fixturePath, "utf8")) as Record<string, unknown>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface KeyGraphDiff {
  /** Dotted paths present in the fixture and absent from the TS object. */
  missingFromTs: string[];
  /** Dotted paths present in the TS object and absent from the fixture. */
  extraInTs: string[];
  /** Dotted paths where one side is an object and the other is not. */
  shapeMismatch: string[];
}

/**
 * Recursively compares two key graphs in both directions.
 *
 * **Keys only — never values.** The fixture's values are deliberately
 * *non-default* (so that a value silently dropped by the Rust round trip
 * cannot coincide with the default that replaces it, which is WI8-A's claim).
 * `DEFAULT_PREFERENCES` is by definition the defaults, so a value comparison
 * here would assert that non-defaults equal defaults and would be wrong. The
 * TS *value* claim that does make sense is the `$defaultKeyboardShortcuts`
 * block against `DEFAULT_KEYBOARD_SHORTCUTS` — that is WI8-F, below.
 *
 * **The `$`-prefix rule** (stated identically on the Rust recursion in
 * `src-tauri/src/models/preferences_wi8_tests.rs`): a **top-level** key whose
 * name begins with `$` is a *sibling annotation block*, not part of the
 * contract document — `$acceptedViewModes`, `$defaultKeyboardShortcuts`,
 * `$README`. No recursion descends into them and neither direction reports
 * them. One stated rule, rather than a list of names nobody remembers.
 *
 * **What counts as a leaf**: anything that is not a plain object. Arrays are
 * leaves and are not recursed into — `recentFiles` is one leaf.
 *
 * **`windowStates` is opaque here**: it is an open-ended
 * `Record<string, WindowGeometry>`, the fixture carries one entry keyed by a
 * user path, and `DEFAULT_PREFERENCES.windowStates` is `{}`. Descending would
 * report the user path as a fixture-only key on every run. The
 * `WindowGeometry` shape the skip would otherwise leave unasserted is
 * recovered by the separate `Required<WindowGeometry>` check in WI8-C below,
 * which `pnpm typecheck:tests` enforces. (The Rust recursion does *not* skip
 * it, because there both sides are the same document round-tripped.)
 */
function diffKeyGraphs(
  fixture: unknown,
  ts: unknown,
  path: string,
  topLevel: boolean,
  diff: KeyGraphDiff,
): void {
  if (!isPlainObject(fixture) || !isPlainObject(ts)) {
    if (isPlainObject(fixture) !== isPlainObject(ts)) {
      diff.shapeMismatch.push(path);
    }
    return;
  }

  const OPAQUE_MAPS = new Set(["windowStates"]);

  for (const key of Object.keys(fixture)) {
    if (topLevel && key.startsWith("$")) continue;
    const child = path === "" ? key : `${path}.${key}`;
    if (!(key in ts)) {
      diff.missingFromTs.push(child);
      continue;
    }
    if (OPAQUE_MAPS.has(key)) continue;
    diffKeyGraphs(fixture[key], ts[key], child, false, diff);
  }

  for (const key of Object.keys(ts)) {
    if (topLevel && key.startsWith("$")) continue;
    if (!(key in fixture)) {
      diff.extraInTs.push(path === "" ? key : `${path}.${key}`);
    }
  }
}

describe("WI-8 — cross-language preference contract parity (TS half)", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    // Browser branch (the helper's default, written out so the intent is visible).
    vi.mocked(isTauri).mockReturnValue(false);
  });

  /**
   * WI8-C — **Law**: the fixture's key graph equals TS `DEFAULT_PREFERENCES`'s,
   * recursively, in both directions.
   *
   * `DEFAULT_PREFERENCES` is not exported, so it is obtained through
   * `preferencesService.getPreferences()` with the `isTauri` spy false — the
   * browser branch returns a deep copy of the constant. `invoke` is mocked only so
   * that an accidental IPC attempt is *visible* rather than a module-resolution
   * error, and is asserted never to have been called: that is what proves the
   * comparison was fed by the real constant and not by the mock's return value.
   */
  it("WI8-C: the fixture's key graph and DEFAULT_PREFERENCES's agree in both directions", async () => {
    const fixture = readContractFixture();
    const { preferencesService } = await import("../src/services/preferencesService");
    const defaults = await preferencesService.getPreferences("app_hydrate");

    expect(invokeMock).not.toHaveBeenCalled();

    const diff: KeyGraphDiff = { missingFromTs: [], extraInTs: [], shapeMismatch: [] };
    diffKeyGraphs(fixture, defaults as unknown, "", true, diff);

    expect({
      inFixtureNotInTs: diff.missingFromTs,
      inTsNotInFixture: diff.extraInTs,
      objectOnOneSideOnly: diff.shapeMismatch,
    }).toEqual({ inFixtureNotInTs: [], inTsNotInFixture: [], objectOnOneSideOnly: [] });

    // `windowStates` is skipped by the recursion above (its only entry is
    // keyed by a user path, and the TS default map is empty), so the
    // `WindowGeometry` shape is asserted here instead. The `Required<…>`
    // record is a compile-time exhaustiveness check: adding a field to the TS
    // `WindowGeometry` without adding it to the fixture fails
    // `pnpm typecheck:tests` on this line before the runtime assertion below
    // is ever reached.
    const WINDOW_GEOMETRY_KEYS: Record<keyof Required<WindowGeometry>, true> = {
      x: true,
      y: true,
      width: true,
      height: true,
      lastAccessed: true,
    };
    const windowStates = fixture.windowStates;
    expect(isPlainObject(windowStates)).toBe(true);
    const entries = Object.values(windowStates as Record<string, unknown>);
    expect(entries).toHaveLength(1);
    expect(Object.keys(entries[0] as Record<string, unknown>).sort()).toEqual(
      Object.keys(WINDOW_GEOMETRY_KEYS).sort(),
    );
  });

  /**
   * WI8-D — the TS `ViewMode` union's members are enumerated here and each one
   * appears in the fixture's `$acceptedViewModes`, so a new TS view mode cannot
   * be added without the Rust side being told (WI8-B is the other half).
   *
   * The `Record<ViewMode, true>` literal is what makes this case more than a
   * restatement: adding a member to the union in `src/types/editor.ts` without
   * adding it here fails `pnpm typecheck:tests` before the runtime assertion is
   * reached.
   *
   * *(Matrix correction: the matrix says this rides on `pnpm build`. It does
   * not — `tsconfig.json` includes only `src`, and `tests/` is type-checked by
   * `pnpm typecheck:tests` via `tsconfig.test.json`.)*
   */
  it("WI8-D: every TS ViewMode member is in the fixture's accepted view-mode list", () => {
    const TS_VIEW_MODE_EXHAUSTIVE: Record<ViewMode, true> = {
      wysiwyg: true,
      source: true,
    };
    const tsViewModes = Object.keys(TS_VIEW_MODE_EXHAUSTIVE);

    const fixture = readContractFixture();
    const accepted = fixture.$acceptedViewModes;
    expect(Array.isArray(accepted)).toBe(true);

    const acceptedList = accepted as string[];
    const notDeclared = tsViewModes.filter((mode) => !acceptedList.includes(mode));
    expect(notDeclared).toEqual([]);
  });

  /**
   * WI8-F — **Law**: the TS shortcut defaults match the shared fixture, by key
   * set *and* by value.
   *
   * Paired with `preferences_wi7_tests.rs::wi7_h_…`, which holds the same
   * fixture block against the real Rust `KeyboardShortcuts::default()`. The
   * pairing *is* the mechanism: this block is the only place the two
   * languages' shortcut **values** meet. Before it existed, 53 of the 58
   * defaults were asserted by nothing on either side of the boundary — which
   * is how `viewSource`, `viewWysiwyg` and `fileOpenQuickly` drifted.
   *
   * This is a deliberate, recorded exception to WI-8's "key sets and enum
   * domains only" criterion, confined to `$defaultKeyboardShortcuts`. The
   * criterion's reason — "a value assertion would rot on every default change"
   * — does not apply to a fixture-held map, which *is* the change record.
   */
  it("WI8-F: DEFAULT_KEYBOARD_SHORTCUTS equals the fixture's $defaultKeyboardShortcuts", () => {
    const fixture = readContractFixture();
    const block = fixture.$defaultKeyboardShortcuts;
    expect(isPlainObject(block)).toBe(true);

    const fixtureShortcuts = block as Record<string, unknown>;
    const ts = DEFAULT_KEYBOARD_SHORTCUTS as unknown as Record<keyof KeyboardShortcuts, string>;

    const disagreements: string[] = [];
    for (const key of Object.keys(fixtureShortcuts)) {
      if (!(key in ts)) {
        disagreements.push(`${key}: fixture=${String(fixtureShortcuts[key])} ts=<absent>`);
        continue;
      }
      const tsValue = ts[key as keyof KeyboardShortcuts];
      if (fixtureShortcuts[key] !== tsValue) {
        disagreements.push(`${key}: fixture=${String(fixtureShortcuts[key])} ts=${tsValue}`);
      }
    }
    for (const key of Object.keys(ts)) {
      if (!(key in fixtureShortcuts)) {
        disagreements.push(`${key}: fixture=<absent> ts=${ts[key as keyof KeyboardShortcuts]}`);
      }
    }

    expect(disagreements).toEqual([]);
  });

  /**
   * M2-06 (ADR-0039) — TS half of MCP default-value parity. WI8-C compares key
   * graphs only, so a TS `DEFAULT_MCP_CONFIG.serverEnabled: false` would pass
   * it; this case holds the TS default values to the fixture's
   * `$defaultMcpConfig`, which `preferences_mcp_tests.rs::m2_05_…` holds the
   * Rust `McpConfig::default()` to. The `Required<…>` record fails
   * `pnpm typecheck:tests` if the TS type keeps the retired `enabled`.
   */
  it("M2-06: DEFAULT_MCP_CONFIG equals the fixture's $defaultMcpConfig and has no enabled", () => {
    const fixture = readContractFixture();
    expect(isPlainObject(fixture.$defaultMcpConfig)).toBe(true);
    expect(DEFAULT_MCP_CONFIG).toEqual(fixture.$defaultMcpConfig);
    expect("enabled" in DEFAULT_MCP_CONFIG).toBe(false);

    const MCP_CONFIG_KEYS: Record<keyof Required<McpConfig>, true> = {
      serverEnabled: true,
      startOnLaunch: true,
      autoApproveEdits: true,
    };
    expect(Object.keys(DEFAULT_MCP_CONFIG).sort()).toEqual(Object.keys(MCP_CONFIG_KEYS).sort());
  });
});
