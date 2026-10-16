/**
 * @module tests/support/settingsRailPrototype
 * Purpose: the D260 geometry oracle. Reads the accepted prototype
 * (`docs/design/mdpro-ui-new/prototypes/d260-settings-rail.html`, variant D)
 * and exposes its `NAV` list and its `LUCIDE` glyph map, so the rail is
 * checked against the design artefact rather than against a copy of itself.
 *
 * Key decisions:
 * - No `src/` import: the oracle must not share code with what it checks.
 * - The two literals are evaluated as JavaScript (`new Function`); they are
 *   plain array and object literals of strings in a committed file.
 * - `parseLucide` / `geometry` need a DOM (`DOMParser`), so callers run
 *   under jsdom. Law: none (a parser).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const PROTOTYPE = join(__dirname, "..", "..", "docs", "design", "mdpro-ui-new", "prototypes", "d260-settings-rail.html");
const html = readFileSync(PROTOTYPE, "utf8");

/** The literal assigned to `const <name> =`, up to its closing `];` / `};` line. */
function literal(name: string, close: "]" | "}"): unknown {
  const start = html.indexOf(`const ${name} = `);
  if (start < 0) throw new Error(`prototype has no const ${name}`);
  const end = html.indexOf(`\n${close};`, start);
  if (end < 0) throw new Error(`prototype const ${name} is not closed`);
  const body = html.slice(start + `const ${name} = `.length, end + 2);
  return new Function(`return ${body};`)();
}

/** `[id, label, emoji]` per rail row, in the prototype's order. */
export const PROTOTYPE_NAV = literal("NAV", "]") as Array<[id: string, label: string, emoji: string]>;

/** Page id → the inner SVG markup of its Lucide-geometry glyph. */
export const PROTOTYPE_LUCIDE = literal("LUCIDE", "}") as Record<string, string>;

export type Geometry = Array<[localName: string, attributes: Record<string, string>]>;

/** Every attribute of `el`, name → value. */
export function attributes(el: Element): Record<string, string> {
  return Object.fromEntries(Array.from(el.attributes).map((a) => [a.name, a.value]));
}

/** The children of `svg`, in order, as element name plus attribute map. */
export function geometry(svg: Element): Geometry {
  return Array.from(svg.children).map((c) => [c.localName, attributes(c)]);
}

/** `markup` (inner SVG) parsed as SVG, as `geometry` of its wrapper. */
export function parseLucide(markup: string): Geometry {
  const doc = new DOMParser().parseFromString(
    `<svg xmlns="http://www.w3.org/2000/svg">${markup}</svg>`,
    "image/svg+xml",
  );
  if (doc.getElementsByTagName("parsererror").length > 0) throw new Error(`unparseable glyph: ${markup}`);
  return geometry(doc.documentElement);
}
