/**
 * Purpose: Pin the behaviour of the rule-50 §1 lint gate
 * (`scripts/lint/no-bare-store-hook.mjs`) — a zero-argument `use*Store()` call
 * is a whole-store subscription and is forbidden at a component's top level.
 *
 * The last block IS the gate: it scans the real `src/` tree and asserts zero
 * findings. Everything above it is a fixture case proving the checker draws the
 * line where the ADR says it does.
 *
 * Fixtures are string literals declared here, not files on disk. A fixture
 * directory under `src/` would be eaten by the repo-wide scan as its own input;
 * one under `tests/` would only be reachable by widening the scan. Both trade a
 * readable test for a gate that lints its own test data.
 *
 * @module tests/lint-no-bare-store-hook.test
 * @coordinates-with scripts/lint/no-bare-store-hook.mjs
 */
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  findBareStoreHookCalls,
  scanTree,
  // @ts-expect-error -- plain ESM script, no .d.ts by design
} from "../scripts/lint/no-bare-store-hook.mjs";

const SRC_DIR = path.resolve(__dirname, "../src");

/** 1-based `{ line, column, text }`, as the checker reports them. */
type Finding = { line: number; column: number; text: string };

const find = (source: string, fileName = "fixture.ts"): Finding[] =>
  findBareStoreHookCalls(source, fileName) as Finding[];

describe("findBareStoreHookCalls — what it flags", () => {
  it("flags a bare whole-store subscription", () => {
    const findings = find(`
      import { useFooStore } from "../stores/fooStore";
      export function Widget() {
        const { a, b } = useFooStore();
        return a + b;
      }
    `);
    expect(findings).toHaveLength(1);
    expect(findings[0].text).toBe("useFooStore()");
    expect(findings[0].line).toBe(4);
  });

  it("flags a bare call that is not destructured either", () => {
    expect(find("const store = useBarStore();")).toHaveLength(1);
  });

  it("reports a 1-based line and column a human can jump to", () => {
    const [finding] = find("const x = 1;\n  const s = useFooStore();");
    expect(finding.line).toBe(2);
    expect(finding.column).toBe(13);
  });

  it("flags every occurrence, not just the first", () => {
    const findings = find("useFooStore();\nuseBarStore();");
    expect(findings.map((f) => f.text)).toEqual(["useFooStore()", "useBarStore()"]);
  });

  it("flags a call nested deep inside a function body", () => {
    const findings = find(`
      export function Outer() {
        function Inner() {
          if (true) {
            const s = useDeepStore();
            return s;
          }
        }
      }
    `);
    expect(findings).toHaveLength(1);
    expect(findings[0].text).toBe("useDeepStore()");
  });
});

describe("findBareStoreHookCalls — what it leaves alone", () => {
  it("ignores a per-field selector, the prescribed form", () => {
    expect(find("const a = useFooStore((s) => s.a);")).toEqual([]);
  });

  it("ignores useFooStore.getState(), the prescribed callback form", () => {
    expect(find("const { a } = useFooStore.getState();")).toEqual([]);
  });

  it("ignores a `//` comment — including the one documenting this very rule", () => {
    expect(find("// A bare `useTOCStore()` subscribes to the state object's identity.")).toEqual(
      [],
    );
  });

  it("ignores a block comment", () => {
    expect(find("/**\n * fails against the bare `useTOCStore()` destructure.\n */\nexport {};")).toEqual(
      [],
    );
  });

  it("ignores a string literal", () => {
    expect(find('expect(src).not.toContain("useEditorStore()");')).toEqual([]);
  });

  it("ignores a template literal", () => {
    expect(find("const msg = `do not write useFooStore() here`;")).toEqual([]);
  });

  it("ignores a hook call that is not a store hook", () => {
    expect(find("useEffect(() => {}, []);\nuseMemo();\nuseStore();")).toEqual([]);
  });

  it("ignores a lowercase-suffixed near-miss (useFoostore / usestore)", () => {
    expect(find("useFoostore();\nusestore();")).toEqual([]);
  });

  it("ignores a store-shaped call that carries an argument", () => {
    expect(find("useFooStore(selectA);")).toEqual([]);
  });
});

describe("findBareStoreHookCalls — parsing", () => {
  it("parses a .tsx file with JSX and still finds the call", () => {
    const findings = find(
      `export function Widget() {
         const { a } = useFooStore();
         return <div className="x">{a}</div>;
       }`,
      "Widget.tsx",
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].text).toBe("useFooStore()");
  });

  it("does not mistake a JSX text node for code", () => {
    expect(find("const el = <p>useFooStore()</p>;", "Widget.tsx")).toEqual([]);
  });

  it("returns nothing for an empty source", () => {
    expect(find("")).toEqual([]);
  });
});

/**
 * Per-test budget for the two cases that scan the real `src/` tree (D28).
 *
 * Each one parses every source file with the TypeScript compiler: ~0.1-0.3 s
 * alone, ~1.2-1.6 s measured inside the full `--coverage` lane with a second
 * lane running beside it, and the cost grows with `src/`. That is too close to
 * vitest's 5 s default, and a synchronous case that finishes late is still
 * failed as a timeout — reported as `Error: STACK_TRACE_ERROR` with a stack
 * captured where `it()` was registered, which is why the failure looked like a
 * collection-time error. This bounds a hang; it is not a performance claim.
 */
const SRC_SCAN_TIMEOUT_MS = 60_000;

describe("the gate: the real src/ tree", { timeout: SRC_SCAN_TIMEOUT_MS }, () => {
  it("scans something — a silent zero from an empty walk is not a pass", () => {
    const scanned = scanTree(SRC_DIR).filesScanned as number;
    expect(scanned).toBeGreaterThan(100);
  });

  it("has zero bare store-hook subscriptions under src/", () => {
    const findings = scanTree(SRC_DIR).findings as (Finding & { file: string })[];
    const rendered = findings.map((f) => `${f.file}:${f.line}:${f.column} ${f.text}`);
    expect(rendered).toEqual([]);
  });
});
