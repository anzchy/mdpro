// @vitest-environment node
/**
 * M1A-WI-7 — the committed `src-tauri/src/menu_layout.json` is exactly what
 * `buildMenuLayout` makes of today's tables, and it decodes back to them.
 * Matrix: .claude/tdd-guardian/tests-20261016-223726.md § M1A-WI-7
 * (freshness, format invariants), R1-7a, R2-4a, R3-3.
 *
 * Check-only by default. To regenerate:
 *   MDPRO_WRITE_MENU_LAYOUT=1 pnpm exec vitest run tests/menu-layout-freshness.test.ts
 * which writes the file and then still asserts.
 */
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { buildMenuLayout, serializeMenuLayout } from "../src/commands/buildMenuLayout";
import { COMMAND_TABLE } from "../src/commands/commandTable";
import type { Platform } from "../src/commands/commandTable.types";
import { EDITOR_OWNED_CHORDS, type EditorOwnedRow } from "../src/commands/editorOwnedChords";
import { RESERVED_CHORDS } from "../src/commands/reservedChords";
import { decodeMenuLayout } from "./support/decodeMenuLayout";

const ROOT = path.resolve(__dirname, "..");
const LAYOUT_PATH = path.join(ROOT, "src-tauri/src/menu_layout.json");
const DECODER_PATH = path.join(ROOT, "tests/support/decodeMenuLayout.ts");
const COMMANDS_DIR = path.join(ROOT, "src/commands") + path.sep;
const PLATFORMS: readonly Platform[] = ["macos", "windows", "linux"];

const built = serializeMenuLayout(buildMenuLayout(COMMAND_TABLE, RESERVED_CHORDS, EDITOR_OWNED_CHORDS));
if (process.env.MDPRO_WRITE_MENU_LAYOUT === "1") writeFileSync(LAYOUT_PATH, built);
const committed = readFileSync(LAYOUT_PATH, "utf8");

describe("freshness", () => {
  it("the in-memory build equals the committed bytes", () => {
    expect(built.length).toBeGreaterThan(1000);
    expect(committed).toBe(built);
  });
});

describe("format invariants of the committed file", () => {
  it("is LF only, with exactly one trailing newline", () => {
    expect(committed.includes("\r")).toBe(false);
    expect(committed.endsWith("\n")).toBe(true);
    expect(committed.endsWith("\n\n")).toBe(false);
  });

  it("is indented by 2 spaces, never tabs", () => {
    const lines = committed.split("\n");
    expect(lines[1]).toMatch(/^ {2}"\$generated": /);
    for (const line of lines) {
      expect(line.includes("\t")).toBe(false);
      expect((/^ */.exec(line)?.[0].length ?? 0) % 2).toBe(0);
    }
  });

  it("leads with $generated naming the test and the write flag", () => {
    const parsed = JSON.parse(committed) as Record<string, unknown>;
    expect(Object.keys(parsed)[0]).toBe("$generated");
    const generated = String(parsed.$generated);
    expect(generated).toContain("tests/menu-layout-freshness.test.ts");
    expect(generated).toContain("MDPRO_WRITE_MENU_LAYOUT=1");
  });
});

// The builder's documented order, restated here rather than imported.
const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const inventoryKey = (r: EditorOwnedRow): string[] => [
  r.editor, r.source, r.key, r.platforms.join(","), JSON.stringify(r),
];
function compareInventory(a: EditorOwnedRow, b: EditorOwnedRow): number {
  const ka = inventoryKey(a);
  const kb = inventoryKey(b);
  for (let i = 0; i < ka.length; i += 1) {
    const c = byCodeUnit(ka[i], kb[i]);
    if (c !== 0) return c;
  }
  return 0;
}

describe("R1-7a: decode(committed) recovers the inputs", () => {
  it("deep-equals the sorted table, reserved list and inventory", () => {
    const decoded = decodeMenuLayout(JSON.parse(committed));
    expect(decoded.table).toStrictEqual([...COMMAND_TABLE].sort((a, b) => byCodeUnit(a.id, b.id)));
    const reserved = Object.fromEntries(PLATFORMS.map((p) => [p, [...RESERVED_CHORDS[p]].sort(byCodeUnit)]));
    expect(decoded.reserved).toStrictEqual(reserved);
    expect(decoded.editorOwned).toStrictEqual([...EDITOR_OWNED_CHORDS].sort(compareInventory));
    expect(decoded.table).toHaveLength(78);
    expect(decoded.editorOwned).toHaveLength(EDITOR_OWNED_CHORDS.length);
  });
});

interface ImportEdge {
  readonly spec: string | null;
  readonly typeOnly: boolean;
}

function importsOf(file: string): ImportEdge[] {
  const sf = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.ES2022, true);
  const edges: ImportEdge[] = [];
  const literal = (e: ts.Expression | undefined) => (e !== undefined && ts.isStringLiteral(e) ? e.text : null);
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st)) {
      const clause = st.importClause;
      const named = clause?.namedBindings;
      const allTypeNamed =
        named !== undefined && ts.isNamedImports(named) && named.elements.every((el) => el.isTypeOnly);
      const typeOnly = clause !== undefined && (clause.isTypeOnly || (clause.name === undefined && allTypeNamed));
      edges.push({ spec: literal(st.moduleSpecifier), typeOnly });
    } else if (ts.isExportDeclaration(st) && st.moduleSpecifier !== undefined) {
      const c = st.exportClause;
      const allTypeNamed = c !== undefined && ts.isNamedExports(c) && c.elements.every((el) => el.isTypeOnly);
      edges.push({ spec: literal(st.moduleSpecifier), typeOnly: st.isTypeOnly || allTypeNamed });
    }
  }
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n)) {
      const callee = n.expression;
      const isImport = callee.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(callee) && callee.text === "require";
      if (isImport || isRequire) edges.push({ spec: literal(n.arguments[0]), typeOnly: false });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return edges;
}

/** A relative or `@/` specifier as a file path; `null` for a package. */
function resolveSpec(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
  else if (spec.startsWith("@/")) base = path.join(ROOT, "src", spec.slice(2));
  else return null;
  for (const ext of ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]) {
    const candidate = base + ext;
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  // Unresolved: keep the path so a chain into src/commands/ is still named.
  return base;
}

describe("R2-4a: the decoder imports only types from src/commands/", () => {
  it("every import that reaches src/commands/ is type-only", () => {
    const edges = importsOf(DECODER_PATH);
    expect(edges.length).toBeGreaterThan(0);
    const intoCommands = edges.filter((e) => {
      const target = e.spec === null ? null : resolveSpec(DECODER_PATH, e.spec);
      return target === null ? e.spec === null : target.startsWith(COMMANDS_DIR);
    });
    expect(intoCommands.length).toBeGreaterThan(0);
    expect(intoCommands.filter((e) => !e.typeOnly)).toStrictEqual([]);
  });
});

describe("R3-3: no value from src/commands/ is reachable from the decoder", () => {
  it("walks value edges only and never lands under src/commands/", () => {
    const chains: string[][] = [];
    const seen = new Set<string>();
    let typeEdgesIntoCommands = 0;
    const walk = (file: string, chain: string[]): void => {
      if (seen.has(file) || !existsSync(file)) return;
      seen.add(file);
      for (const edge of importsOf(file)) {
        if (edge.spec === null) {
          if (!edge.typeOnly) chains.push([...chain, "<dynamic specifier>"]);
          continue;
        }
        const target = resolveSpec(file, edge.spec);
        if (target === null) continue;
        const rel = path.relative(ROOT, target);
        if (edge.typeOnly) {
          if (target.startsWith(COMMANDS_DIR)) typeEdgesIntoCommands += 1;
          continue;
        }
        if (target.startsWith(COMMANDS_DIR)) chains.push([...chain, rel]);
        else walk(target, [...chain, rel]);
      }
    };
    walk(DECODER_PATH, [path.relative(ROOT, DECODER_PATH)]);
    expect(typeEdgesIntoCommands).toBeGreaterThan(0);
    expect(chains.map((c) => c.join(" -> "))).toStrictEqual([]);
  });
});
