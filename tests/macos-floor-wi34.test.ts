// @vitest-environment node
/**
 * @module macos-floor-wi34.test
 * Purpose: pin the macOS floor at 13.1 (plan P WI-3.4, decision E1,
 * ADR-0101). macOS 13.1's bundled WebKit (Safari 16.2) is the first with
 * `color-mix()`, which the theme tokens use with no `@supports` fallback.
 * Without `bundle.macOS.minimumSystemVersion` Tauri writes its default
 * (10.13) into `LSMinimumSystemVersion`, so the app would launch on a macOS
 * whose WebKit drops every derived colour.
 *
 * Strategy: read the config, not a build. The packaged `Info.plist` is
 * checked by hand (docs/guide/manual-test-ui-redesign.md § 6).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");
const conf = JSON.parse(readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf8"));

describe("WI-3.4: the macOS floor is 13.1", () => {
  it("tauri.conf.json sets bundle.macOS.minimumSystemVersion to 13.1", () => {
    expect(conf.bundle?.macOS?.minimumSystemVersion).toBe("13.1");
  });

  it("the floor is what the theme CSS needs: the themes use color-mix()", () => {
    // If color-mix() ever leaves the themes, the floor's reason is gone and
    // this test should be revisited rather than the floor kept by habit.
    for (const theme of ["light", "dark"]) {
      const css = readFileSync(join(root, "src", "styles", "themes", `${theme}.css`), "utf8");
      expect(css).toMatch(/color-mix\(/);
    }
  });
});
