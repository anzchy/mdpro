// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  assertNoNodeEnvironmentViolations,
  GUARDED_GLOBALS,
} from "./helpers/nodeEnvironmentGuard";

/*
 * ADR-0049: tests/setup.ts installs the guard in every file that runs without a
 * DOM, this one included. Each case that trips it drains the recorded violation
 * itself, or the setup's afterAll would (correctly) fail this file.
 */
function drained(): string {
  try {
    assertNoNodeEnvironmentViolations();
    return "";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

describe("node-environment guard (ADR-0049)", () => {
  it("throws when first-party code reads a global Node really has (navigator)", () => {
    expect(() => navigator.platform).toThrow(/global `navigator`.*@vitest-environment node/);
    expect(drained()).toMatch(/1 DOM global read/);
  });

  it("throws on a `typeof window` probe instead of quietly taking the no-DOM branch", () => {
    expect(() => typeof window).toThrow(/global `window`/);
    expect(drained()).toMatch(/global `window`/);
  });

  it("still fails the file when the code under test swallows the throw", () => {
    const probe = (): boolean => {
      try {
        return typeof document !== "undefined";
      } catch {
        return false;
      }
    };
    expect(probe()).toBe(false);
    expect(drained()).toMatch(/global `document`/);
  });

  it("lets a test stub a guarded global explicitly", () => {
    vi.stubGlobal("navigator", { platform: "MacIntel" });
    expect(navigator.platform).toBe("MacIntel");
    expect(drained()).toBe("");
  });

  it("guards every name it declares", () => {
    const scope = globalThis as unknown as Record<string, unknown>;
    for (const name of GUARDED_GLOBALS) {
      expect(() => scope[name], name).toThrow(new RegExp(`global \`${name}\``));
    }
    expect(drained()).toMatch(new RegExp(`^${GUARDED_GLOBALS.length} DOM global read`));
  });

  it("leaves Node's own Event / EventTarget alone", () => {
    expect(typeof EventTarget).toBe("function");
    expect(drained()).toBe("");
  });
});
