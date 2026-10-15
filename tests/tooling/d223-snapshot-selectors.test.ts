// @vitest-environment node
/**
 * D223 (audit b141 M4): the redesign snapshot script must not wait on or
 * sample the sidebar header and mode badge that D223 deleted, or every
 * surface that names them reports ok:false. The mode is read from which
 * editor container is mounted, and the sidebar's top band is sampled by its
 * drag-region class.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const snapshot = readFileSync(join(__dirname, "..", "..", "scripts", "redesign", "snapshot.js"), "utf8");

describe("D223 snapshot.js selectors follow the removed sidebar labels", () => {
  it("names neither deleted class", () => {
    expect(snapshot).not.toMatch(/\.sidebar-header\b/);
    expect(snapshot).not.toMatch(/\.sidebar-mode-label\b/);
  });

  it("no phase asserts on the badge's text", () => {
    expect(snapshot).not.toMatch(/\bmodeLabel\b/);
    expect(snapshot).not.toMatch(/=== "(SOURCE|WYSIWYG)"/);
  });

  it("the sidebar group samples the top band that replaced the header", () => {
    expect(snapshot).toMatch(/var SIDEBAR = \["\.sidebar-traffic-area"\];/);
  });
});
