/**
 * @module design-tokens-accent-danger.test
 * Purpose: Verify the new --color-accent-soft, --color-danger,
 * --color-danger-soft tokens land in BOTH theme files (rule 31:
 * "add to both theme files in the same commit") and that the
 * obvious hardcoded sites in globals.css migrate to use them.
 *
 * Strategy: source inspection over the CSS files. Mirrors
 * tests/milkdown-image-resize.test.ts CSS-presence pattern.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const lightCss = fs.readFileSync(
  path.join(ROOT, "src/styles/themes/light.css"),
  "utf-8",
);
const darkCss = fs.readFileSync(
  path.join(ROOT, "src/styles/themes/dark.css"),
  "utf-8",
);
const globalsCss = fs.readFileSync(
  path.join(ROOT, "src/styles/globals.css"),
  "utf-8",
);

describe("design tokens — light theme declarations", () => {
  it("declares --color-accent-soft", () => {
    expect(lightCss).toMatch(/--color-accent-soft:/);
  });

  it("declares --color-danger", () => {
    expect(lightCss).toMatch(/--color-danger:/);
  });

  it("declares --color-danger-soft", () => {
    expect(lightCss).toMatch(/--color-danger-soft:/);
  });
});

describe("design tokens — dark theme declarations", () => {
  it("declares --color-accent-soft", () => {
    expect(darkCss).toMatch(/--color-accent-soft:/);
  });

  it("declares --color-danger", () => {
    expect(darkCss).toMatch(/--color-danger:/);
  });

  it("declares --color-danger-soft", () => {
    expect(darkCss).toMatch(/--color-danger-soft:/);
  });
});

describe("design tokens — :root defaults in globals.css", () => {
  it("declares --color-accent-soft for non-Tauri / first-paint contexts", () => {
    expect(globalsCss).toMatch(/--color-accent-soft:/);
  });

  it("declares --color-danger for non-Tauri / first-paint contexts", () => {
    expect(globalsCss).toMatch(/--color-danger:/);
  });

  it("declares --color-danger-soft for non-Tauri / first-paint contexts", () => {
    expect(globalsCss).toMatch(/--color-danger-soft:/);
  });
});

describe("hardcoded → token migration in globals.css", () => {
  it("link-insert-input focus ring uses var(--color-accent-soft)", () => {
    // Was: rgba(37, 99, 235, 0.15)
    expect(globalsCss).toMatch(
      /\.link-insert-input:focus[^}]*box-shadow:[^;]*var\(--color-accent-soft\)/s,
    );
  });

  it("table-insert-input focus ring uses var(--color-accent-soft)", () => {
    expect(globalsCss).toMatch(
      /\.table-insert-input:focus[^}]*box-shadow:[^;]*var\(--color-accent-soft\)/s,
    );
  });

  it("table-insert-error uses var(--color-danger) and var(--color-danger-soft)", () => {
    // Was: color: #dc2626; background: rgba(220, 38, 38, 0.08); border: ...rgba(220, 38, 38, 0.25)
    expect(globalsCss).toMatch(
      /\.table-insert-error[^}]*color:\s*var\(--color-danger\)/s,
    );
    expect(globalsCss).toMatch(
      /\.table-insert-error[^}]*background:\s*var\(--color-danger-soft\)/s,
    );
  });

  it("toolbar-button.danger uses var(--color-danger) for color/border", () => {
    expect(globalsCss).toMatch(
      /\.toolbar-button\.danger[^}]*color:\s*var\(--color-danger\)/s,
    );
    expect(globalsCss).toMatch(
      /\.toolbar-button\.danger[^}]*border-color:\s*var\(--color-danger\)/s,
    );
  });

  it("toolbar-button.danger:hover background uses var(--color-danger-soft)", () => {
    expect(globalsCss).toMatch(
      /\.toolbar-button\.danger:hover[^}]*background:\s*var\(--color-danger-soft\)/s,
    );
  });

  it("settings-error uses --color-danger / --color-danger-soft tokens", () => {
    expect(globalsCss).toMatch(
      /\.settings-error[^}]*color:\s*var\(--color-danger\)/s,
    );
    expect(globalsCss).toMatch(
      /\.settings-error[^}]*background:\s*var\(--color-danger-soft\)/s,
    );
  });

  it("file-item.is-active box-shadow uses var(--color-accent-soft)", () => {
    expect(globalsCss).toMatch(
      /\.file-item\.is-active[^}]*box-shadow:[^;]*var\(--color-accent-soft\)/s,
    );
  });
});
