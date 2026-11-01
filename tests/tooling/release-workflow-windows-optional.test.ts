// @vitest-environment node
/**
 * ADR0164-WI1 AC-2: `windows=false` removes exactly the windows-x86_64 build row; `true` or absent
 * keeps all four (ADR-0164 decision 2). Matrix cases X1–X10′, M1, M2, S1.
 *
 * Why the matrix is an object-valued `target` vector and not `include` rows: GitHub processes every
 * `include` after `exclude` and re-creates an excluded combination from its include entry, so an
 * exclude cannot remove an include-only row. The exclude entry copies the whole Windows object, so
 * it matches whether GitHub compares nested objects exactly or as a subset; both readings are
 * modelled below, and the model itself is pinned by known answers (M1, M2). GitHub's real expansion
 * is proved by the delegator's two build-only smokes (ruling 1, G6).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { at, items, job, keys, scalar, steps, stepRun } from "../support/workflowBlocks";

const FILE = path.resolve(__dirname, "..", "..", ".github", "workflows", "release.yml");
const TEXT = fs.readFileSync(FILE, "utf8");
const BUILD = job(TEXT, "build") ?? "";

type Obj = Record<string, string>;
const toObj = (block: string | null): Obj =>
  Object.fromEntries(keys(block ?? "").map((k) => [k, scalar(block, k) ?? ""]));

const rows = (): Obj[] => items(at(BUILD, ["strategy", "matrix", "target"]) ?? "").map(toObj);
const excludeItems = (): string[] => items(at(BUILD, ["strategy", "matrix", "exclude"]) ?? "");
const excludeTarget = (): Obj => toObj(at(excludeItems()[0] ?? "", ["target"]));

/** The only expression form accepted: `${{ inputs.windows && '<a>' || '<b>' }}`, anchored. */
const FORM = /^\$\{\{\s*inputs\.windows\s*&&\s*'([^']+)'\s*\|\|\s*'([^']+)'\s*\}\}$/;
function parseForm(expr: string): { a: string; b: string } | null {
  const m = FORM.exec(expr.trim());
  return m ? { a: m[1], b: m[2] } : null;
}

/** GitHub truthiness: false, 0, -0, '', null are falsy; && and || return an operand. */
const truthy = (v: unknown) => !(v === false || v === 0 || v === "" || v === null || v === undefined);
const ghAndOr = (x: unknown, a: unknown, b: unknown): unknown => {
  const left = truthy(x) ? a : x;
  return truthy(left) ? left : b;
};

const exact = (ex: Obj, row: Obj) => {
  const k = Object.keys(ex);
  return k.length === Object.keys(row).length && k.every((key) => row[key] === ex[key]);
};
const subset = (ex: Obj, row: Obj) => Object.keys(ex).every((key) => key in row && row[key] === ex[key]);

/** The declared default, read from the file (not hard-coded). */
const declaredDefault = (): boolean => {
  const d = scalar(at(TEXT, ["on", "workflow_dispatch", "inputs", "windows"]), "default");
  if (d !== "true" && d !== "false") throw new Error(`windows default is not a boolean literal: ${d}`);
  return d === "true";
};

/** Platforms that survive the exclude for a given input value (undefined = absent → default). */
function surviving(windows: boolean | undefined, match: (ex: Obj, row: Obj) => boolean): string[] {
  const value = windows === undefined ? declaredDefault() : windows;
  const ex = excludeTarget();
  const form = parseForm(ex.platform ?? "");
  if (!form) throw new Error(`exclude platform is not the accepted form: ${ex.platform}`);
  const evaluated: Obj = { ...ex, platform: String(ghAndOr(value, form.a, form.b)) };
  return rows()
    .filter((r) => !match(evaluated, r))
    .map((r) => r.platform)
    .sort();
}

const ALL = ["darwin-aarch64", "darwin-x86_64", "linux-x86_64", "windows-x86_64"];
const NO_WINDOWS = ["darwin-aarch64", "darwin-x86_64", "linux-x86_64"];

describe("M1/M2 the model of GitHub's semantics, by known answers", () => {
  it("M1 && / || return operands with GitHub falsiness", () => {
    expect(ghAndOr(true, "a", "b")).toBe("a");
    expect(ghAndOr(false, "a", "b")).toBe("b");
    expect(ghAndOr(true, "", "b")).toBe("b");
    expect(ghAndOr(true, 0, "b")).toBe("b");
    expect(ghAndOr(null, "a", "b")).toBe("b");
  });

  it("M2 subset rejects a differing key; exact rejects a strict subset; both accept the whole copy", () => {
    const win: Obj = { os: "windows-latest", platform: "windows-x86_64", bundles: "nsis" };
    expect(subset({ platform: "windows-x86_64", os: "windows-2022" }, win)).toBe(false);
    expect(exact({ platform: "windows-x86_64" }, win)).toBe(false);
    expect(subset({ platform: "windows-x86_64" }, win)).toBe(true);
    expect(exact({ ...win }, win)).toBe(true);
    expect(subset({ ...win }, win)).toBe(true);
  });
});

describe("ADR0164-WI1 AC-2: the exclude", () => {
  it("S1 strategy is exactly fail-fast: false plus the matrix", () => {
    const strategy = at(BUILD, ["strategy"]);
    expect(keys(strategy ?? "")).toEqual(["fail-fast", "matrix"]);
    expect(scalar(strategy, "fail-fast")).toBe("false");
  });

  it("X4 the matrix is the target vector plus one exclude entry keyed only by target (no include)", () => {
    expect(keys(at(BUILD, ["strategy", "matrix"]) ?? "")).toEqual(["target", "exclude"]);
    expect(rows().map((r) => r.platform).sort()).toEqual(ALL);
    expect(excludeItems()).toHaveLength(1);
    expect(keys(excludeItems()[0])).toEqual(["target"]);
  });

  for (const [name, match] of [
    ["exact", exact],
    ["subset", subset],
  ] as const) {
    it(`X1 windows=false leaves exactly the other three rows (${name} match)`, () => {
      expect(surviving(false, match)).toEqual(NO_WINDOWS);
    });
    it(`X2 windows=true keeps all four rows (${name} match)`, () => {
      expect(surviving(true, match)).toEqual(ALL);
    });
    it(`X3 windows absent takes the declared default and keeps all four rows (${name} match)`, () => {
      expect(declaredDefault()).toBe(true);
      expect(surviving(undefined, match)).toEqual(ALL);
    });
  }

  it("X5 the exclude object is a whole copy of the Windows row, and its true branch matches no platform", () => {
    const form = parseForm(excludeTarget().platform ?? "");
    expect(form).not.toBeNull();
    const win = rows().find((r) => r.platform === "windows-x86_64") as Obj;
    expect({ ...excludeTarget(), platform: form?.b }).toEqual(win);
    expect(rows().some((r) => r.platform === form?.a)).toBe(false);
  });

  it("X6/X7′ the parse is anchored and refuses the wrong spellings", () => {
    expect(parseForm("${{ inputs.windows && 'none' || 'windows-x86_64' }}")).toEqual({ a: "none", b: "windows-x86_64" });
    expect(parseForm("${{ github.event.inputs.windows && 'none' || 'windows-x86_64' }}")).toBeNull();
    expect(parseForm("${{ inputs.windows && '' || 'windows-x86_64' }}")).toBeNull();
    expect(parseForm("${{ !inputs.windows && 'windows-x86_64' || 'none' }}")).toBeNull();
    expect(parseForm("x ${{ inputs.windows && 'none' || 'windows-x86_64' }}")).toBeNull();
  });

  it("X8′ inputs.windows is used exactly twice (exclude and notice) and github.event.inputs never", () => {
    expect((TEXT.match(/(?<![\w.])inputs\.windows\b/g) ?? []).length).toBe(2);
    expect(TEXT).not.toContain("github.event.inputs");
  });

  it("X9′ every build-job matrix reference is at its base site, under matrix.target", () => {
    // The build job's matrix-reference lines at base cf9e975a, in order (matrix.<k> spelling).
    const base = [
      "runs-on: ${{ matrix.os }}",
      "run: rustup target add ${{ matrix.rust_target }}",
      "run: touch src-tauri/binaries/mdpro_mcp-${{ matrix.sidecar_triple }}",
      'run: touch "src-tauri/binaries/mdpro_mcp-${{ matrix.sidecar_triple }}.exe"',
      "run: touch src-tauri/binaries/mdpro_mcp-${{ matrix.sidecar_triple }}",
      "cargo build --release --bin mdpro_mcp --target ${{ matrix.rust_target }}",
      "cp target/${{ matrix.rust_target }}/release/mdpro_mcp binaries/mdpro_mcp-${{ matrix.sidecar_triple }}",
      'cp target/release/mdpro_mcp.exe "binaries/mdpro_mcp-${{ matrix.sidecar_triple }}.exe"',
      "cp target/release/mdpro_mcp binaries/mdpro_mcp-${{ matrix.sidecar_triple }}",
      'SIDECAR="src-tauri/binaries/mdpro_mcp-${{ matrix.sidecar_triple }}"',
      "run: pnpm tauri build --target ${{ matrix.rust_target }} --bundles ${{ matrix.bundles }}",
      'run: node scripts/release/collect-assets.mjs --platform ${{ matrix.platform }} --version "$VERSION"',
      "name: build-${{ matrix.platform }}",
      "path: dist-release/${{ matrix.platform }}/",
    ];
    const lines = TEXT.split("\n")
      .filter((l) => l.includes("matrix."))
      .map((l) => l.trim());
    expect(lines.every((l) => !/matrix\.(?!target\.)/.test(l))).toBe(true);
    expect(lines.map((l) => l.replaceAll("matrix.target.", "matrix."))).toEqual(base);
  });

  it("X10′ preflight carries one notice step, guarded by a quoted or expression negation of inputs.windows", () => {
    const notices = steps(job(TEXT, "preflight")).filter((s) => (stepRun(s) ?? "").includes("::notice::"));
    expect(notices).toHaveLength(1);
    const run = stepRun(notices[0]) ?? "";
    expect(run).toContain("ADR-0164");
    expect(run).not.toContain("${{");
    const ifLine = notices[0].split("\n").find((l) => /^\s*(-\s+)?if:/.test(l)) ?? "";
    expect(ifLine).toMatch(
      /^\s*(-\s+)?if:\s+(\$\{\{\s*!\s*inputs\.windows\s*\}\}|"!inputs\.windows"|'!inputs\.windows'|inputs\.windows\s*==\s*false)\s*$/,
    );
  });

  it("X10′ no if: value anywhere starts with an unquoted ! (a YAML tag)", () => {
    const bad = TEXT.split("\n").filter((l) => /^\s*(-\s+)?if:\s+!/.test(l));
    expect(bad).toEqual([]);
    expect(/^\s*(-\s+)?if:\s+!/.test("        if: !inputs.windows")).toBe(true);
  });
});
