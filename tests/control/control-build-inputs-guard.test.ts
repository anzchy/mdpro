// @vitest-environment node
/**
 * WI-5 (ADR-0047): no build input reaches into an excluded root.
 * Matrix: `.claude/tdd-guardian/tests-20261002-155158.md`, unit WI-5, T01..T07.
 * Plan decision O10 fixes what "relative specifier" and "config path value" mean.
 *
 * The excluded roots are not part of `sourceTree`, so a build input that
 * reads one would make two different builds share a `buildId`. The guard
 * looks at syntactic reference positions only, because `src/` mentions
 * `docs/` in plenty of comments.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  findExcludedRefs,
  formatFindings,
  listBuildInputs,
  // @ts-expect-error -- plain ESM script, no .d.ts by design
} from "../../scripts/control/buildInputsGuard.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { DEFAULT_EXCLUDES } from "../../scripts/control/sourceTree.mjs";

type Finding = { file: string; line: number; ref: string };

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const find = (relPath: string, text: string, excludes: readonly string[] = DEFAULT_EXCLUDES): Finding[] =>
  findExcludedRefs(relPath, text, excludes);

describe("WI-5 build-input reference guard", () => {
  it("WI-5/T01 the live repo has zero findings over a non-empty file set", () => {
    const files: string[] = listBuildInputs(REPO_ROOT);

    for (const single of [
      "src-tauri/build.rs",
      "src-tauri/tauri.conf.json",
      "src-tauri/tauri.verify.conf.json",
      "src-tauri/capabilities/default.json",
      "src-tauri/Cargo.toml",
      "vite.config.ts",
      "index.html",
      "package.json",
    ]) {
      expect(files, `scanned set is missing ${single}`).toContain(single);
    }
    expect(files.filter((f) => /^src-tauri\/capabilities\/[^/]+\.json$/.test(f)).length).toBeGreaterThanOrEqual(1);
    expect(files.filter((f) => f.startsWith("src/")).length).toBeGreaterThan(50);
    expect(files.filter((f) => f.startsWith("src-tauri/src/")).length).toBeGreaterThan(20);
    expect(files.filter((f) => f.endsWith("_tests.rs"))).toEqual([]);

    const findings: Finding[] = files.flatMap((f) =>
      find(f, fs.readFileSync(path.join(REPO_ROOT, f), "utf8"), DEFAULT_EXCLUDES),
    );
    expect(findings, formatFindings(findings)).toEqual([]);
  });

  it("WI-5/T02 JS/TS specifier positives, resolved against the file's directory", () => {
    const text = [
      'import x from "../../docs/a.md"',
      'const m = await import("../../docs/x")',
      'require("../../.claude/y.json")',
      'export * from "../../docs/z"',
      'import "../../tsconfig.node.tsbuildinfo"',
    ].join("\n");
    expect(find("src/a/b.ts", text)).toEqual([
      { file: "src/a/b.ts", line: 1, ref: "../../docs/a.md" },
      { file: "src/a/b.ts", line: 2, ref: "../../docs/x" },
      { file: "src/a/b.ts", line: 3, ref: "../../.claude/y.json" },
      { file: "src/a/b.ts", line: 4, ref: "../../docs/z" },
      { file: "src/a/b.ts", line: 5, ref: "../../tsconfig.node.tsbuildinfo" },
    ]);
  });

  it("WI-5/T03 Rust include positives", () => {
    const text = [
      'const A: &str = include_str!("../../docs/x.md");',
      'const B: &[u8] = include_bytes!("../../.claude/k");',
    ].join("\n");
    expect(find("src-tauri/src/x.rs", text)).toEqual([
      { file: "src-tauri/src/x.rs", line: 1, ref: "../../docs/x.md" },
      { file: "src-tauri/src/x.rs", line: 2, ref: "../../.claude/k" },
    ]);
  });

  it("WI-5/T04 config and HTML positives", () => {
    const tauriConf = find("src-tauri/tauri.conf.json", '{"build":{"frontendDist":"../docs"}}');
    const capability = find(
      "src-tauri/capabilities/default.json",
      '{"identifier":"default","permissions":[{"identifier":"fs:allow","allow":[{"path":"../docs/x"}]}]}',
    );
    const cargo = find("src-tauri/Cargo.toml", ['foo = { path = "../docs/x" }', 'build = "../.claude/b.rs"'].join("\n"));
    const html = find("index.html", ['<script src="/docs/x.js"></script>', '<link href="./.claude/a.css">'].join("\n"));
    const vite = find("vite.config.ts", 'publicDir: "docs"');

    expect(tauriConf).toEqual([{ file: "src-tauri/tauri.conf.json", line: 1, ref: "../docs" }]);
    expect(capability).toEqual([{ file: "src-tauri/capabilities/default.json", line: 1, ref: "../docs/x" }]);
    expect(cargo).toEqual([
      { file: "src-tauri/Cargo.toml", line: 1, ref: "../docs/x" },
      { file: "src-tauri/Cargo.toml", line: 2, ref: "../.claude/b.rs" },
    ]);
    expect(html).toEqual([
      { file: "index.html", line: 1, ref: "/docs/x.js" },
      { file: "index.html", line: 2, ref: "./.claude/a.css" },
    ]);
    expect(vite).toEqual([{ file: "vite.config.ts", line: 1, ref: "docs" }]);
    expect([...tauriConf, ...capability, ...cargo, ...html, ...vite]).toHaveLength(7);
  });

  it.each([
    ["src/a/b.ts", "// see docs/adr/0003"],
    ["src/a/b.ts", "/* docs/ */"],
    ["src/a/b.ts", 'const label = "docs/"'],
    ["src/a/b.ts", 'log("see .claude/rules")'],
    ["src-tauri/src/x.rs", '/// docs/x\nlet s = "docs/";'],
    ["index.html", "<!-- docs/ -->"],
    ["src/a/b.ts", 'import x from "./docs/x"'],
    ["src-tauri/Cargo.toml", 'description = "see docs/"'],
    // Additions beyond the matrix: a reference position that is commented out.
    ["src/a/b.ts", '// import x from "../../docs/a.md"'],
    ["src-tauri/src/x.rs", '// include_str!("../../docs/x.md")'],
    ["index.html", '<!-- <script src="/docs/x.js"></script> -->'],
    ["src-tauri/Cargo.toml", '# path = "../docs/x"'],
  ])("WI-5/T05 non-path mentions are not findings: %s %j", (relPath, text) => {
    expect(find(relPath, text)).toEqual([]);
  });

  it("WI-5/T06 the guarded list comes from the argument", () => {
    const text = ['import a from "../generated/a"', 'import b from "../docs/b"'].join("\n");
    expect(find("src/x.ts", text, ["generated/"])).toEqual([{ file: "src/x.ts", line: 1, ref: "../generated/a" }]);
  });

  it("D75(c) the verify-profile Tauri config is a build input, resolved against src-tauri/", () => {
    // `--config src-tauri/tauri.verify.conf.json` merges into the verify build,
    // so its string values reach the built app exactly like tauri.conf.json's.
    expect(find("src-tauri/tauri.verify.conf.json", '{"build":{"frontendDist":"../docs"}}')).toEqual([
      { file: "src-tauri/tauri.verify.conf.json", line: 1, ref: "../docs" },
    ]);
  });

  it("WI-5/T07 the failure message names file and line", () => {
    const out: string = formatFindings([{ file: "src/x.ts", line: 3, ref: "../docs/a" }]);
    expect(out).toContain("src/x.ts:3");
    expect(out).toContain("../docs/a");
  });
});
