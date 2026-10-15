// @vitest-environment node
/**
 * D75(d): the computed-style snapshot (`scripts/redesign/snapshot.js`) must
 * sample transform and positioning, or a moved element produces identical JSON.
 *
 * The script is a self-contained /browse `eval` payload (an IIFE with no
 * exports), so its property list is read from the source text rather than
 * imported. The case that motivated this: the checked toggle's thumb
 * (`.toggle-slider:before`) moves with `transform: translateX(...)`; dropping
 * that rule left every sampled property unchanged.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SNAPSHOT_JS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../scripts/redesign/snapshot.js");

function stringArray(source: string, name: string): string[] {
  const m = new RegExp(String.raw`var ${name} = \[([\s\S]*?)\];`).exec(source);
  if (!m) throw new Error(`no \`var ${name} = [...]\` in snapshot.js`);
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

describe("D75(d) snapshot.js samples transform and positioning", () => {
  const source = fs.readFileSync(SNAPSHOT_JS, "utf8");
  const props = stringArray(source, "PROPS");

  it.each(["transform", "translate", "position", "top", "right", "bottom", "left"])(
    "PROPS includes %s",
    (prop) => {
      expect(props).toContain(prop);
    },
  );

  it("pseudo-elements sample the same list (PSEUDO_PROPS extends PROPS)", () => {
    expect(source).toMatch(/var PSEUDO_PROPS = PROPS\.concat\(/);
  });

  it("PROPS has no duplicates", () => {
    expect(new Set(props).size).toBe(props.length);
  });
});
