// @vitest-environment node
/**
 * ADR-0047 WI-002 / WI-4..WI-5: the source structure of the verify-run guard.
 * Matrix: `.claude/tdd-guardian/tests-20261003-061500.md` (r1), WI5-T11,
 * WI5-T12, WI5-T13, WI5-T15(b) and WI3-T07.
 *
 * Structural on purpose: "the module is compiled only with the feature" is
 * not observable from the feature-off test binary, and the feature-on lane
 * cannot see what the feature-off build would contain. Sources are read
 * through `commentBlanker.mjs`, so a commented-out line never counts.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { blankComments } from "../scripts/control/commentBlanker.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC_TAURI = path.join(REPO_ROOT, "src-tauri");

function readBlankedRust(rel: string): string {
  return blankComments(fs.readFileSync(path.join(SRC_TAURI, rel), "utf8"), "rust") as string;
}

/** Non-blank lines, whitespace-normalised (runs of whitespace → one space, trimmed). */
function codeLines(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 0);
}

/** The body lines of one TOML table, up to the next `[header]`. */
function tomlTable(toml: string, name: string): string[] | null {
  const lines = toml.split("\n").map((l) => l.replace(/#.*$/, "").trim());
  const start = lines.indexOf(`[${name}]`);
  if (start === -1) return null;
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("[")) break;
    if (line.length > 0) body.push(line);
  }
  return body;
}

describe("WI5-T12: gated module declaration and Cargo feature", () => {
  it("declares verify_run directly under #[cfg(feature = \"verify-run\")] in services/mod.rs", () => {
    const lines = codeLines(readBlankedRust("src/services/mod.rs"));
    const at = lines.indexOf("pub mod verify_run;");
    expect(at, "services/mod.rs declares `pub mod verify_run;`").toBeGreaterThan(0);
    expect(lines[at - 1]).toBe('#[cfg(feature = "verify-run")]');
  });

  it("has verify-run = [] in [features], not enabled by default", () => {
    const toml = fs.readFileSync(path.join(SRC_TAURI, "Cargo.toml"), "utf8");
    const features = tomlTable(toml, "features");
    expect(features, "Cargo.toml has a [features] table").not.toBeNull();
    const entries = (features ?? []).map((l) => l.replace(/\s+/g, ""));
    expect(entries).toContain("verify-run=[]");
    const dflt = entries.find((l) => l.startsWith("default="));
    if (dflt !== undefined) expect(dflt).not.toMatch(/"verify-run"/);
  });
});

/** The text between the `{` that opens `fn <name>(` and its matching `}`. */
function fnBody(text: string, name: string): string {
  const at = text.search(new RegExp(`\\bfn ${name}\\s*[(<]`));
  expect(at, `fn ${name} exists`).toBeGreaterThanOrEqual(0);
  const open = text.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") depth++;
    if (text[i] === "}" && --depth === 0) return text.slice(open + 1, i);
  }
  throw new Error(`fn ${name}: unbalanced braces`);
}

/** Every `.rs` file under `dir`, recursively, as repo-relative paths. */
function rustFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return rustFiles(full);
    return e.name.endsWith(".rs") ? [full] : [];
  });
}

const CFG_LINE = '#[cfg(feature = "verify-run")]';
const ENFORCE_CALL = "tauri_app_lib::services::verify_run::enforce(BUILD_ID_RAW);";

describe("WI5-T11: the guard is the first statement of main()", () => {
  it("opens main() with the cfg-gated enforce call, before startup and app.launch", () => {
    const main = fnBody(readBlankedRust("src/main.rs"), "main");
    const lines = codeLines(main);
    expect(lines.slice(0, 2)).toEqual([CFG_LINE, ENFORCE_CALL]);
    const call = main.indexOf("verify_run::enforce(");
    expect(call).toBeLessThan(main.indexOf("let startup"));
    expect(call).toBeLessThan(main.indexOf('"app.launch"'));
  });
});

describe("WI5-T13: no ungated verify_run reference outside services/verify_run*.rs", () => {
  it("has exactly the mod.rs declaration and the main.rs call, each under the cfg", () => {
    const srcRoot = path.join(SRC_TAURI, "src");
    const found: string[] = [];
    for (const file of rustFiles(srcRoot)) {
      const rel = path.relative(srcRoot, file).split(path.sep).join("/");
      if (/^services\/verify_run[^/]*\.rs$/.test(rel)) continue;
      const lines = blankComments(fs.readFileSync(file, "utf8"), "rust").split("\n") as string[];
      lines.forEach((line, i) => {
        const hits = line.match(/\bverify_run\b/g) ?? [];
        for (let k = 0; k < hits.length; k++) {
          const prev = lines
            .slice(0, i)
            .map((l) => l.replace(/\s+/g, " ").trim())
            .filter((l) => l.length > 0)
            .pop();
          found.push(`${rel}|${prev}`);
        }
      });
    }
    expect(found.sort()).toEqual([`main.rs|${CFG_LINE}`, `services/mod.rs|${CFG_LINE}`]);
  });
});

describe("WI5-T15(b): enforce's inputs come only from guard_inputs", () => {
  const src = readBlankedRust("src/services/verify_run.rs");
  const count = (body: string, needle: string) => body.split(needle).length - 1;

  it("enforce calls guard_inputs once and computes no path itself", () => {
    const body = fnBody(src, "enforce");
    expect(count(body, "guard_inputs(")).toBe(1);
    for (const bad of ["runs_parent_in(", "runs_parent(", "var_os", "env::var", "dirs::"]) {
      expect(body, bad).not.toContain(bad);
    }
  });

  it("guard_inputs takes the parent from runs_parent only", () => {
    const body = fnBody(src, "guard_inputs");
    expect(body).toContain("runs_parent(");
    for (const bad of ["runs_parent_in(", "var_os", "env::var", "dirs::"]) {
      expect(body, bad).not.toContain(bad);
    }
  });

  it("runs_parent is pure path computation over getpwuid_r", () => {
    const body = fnBody(src, "runs_parent");
    expect(body).toContain("getpwuid_r");
    expect(body).toContain("runs_parent_in(");
    for (const bad of [
      "canonicalize",
      "create_dir",
      "metadata",
      "exists(",
      "read_dir",
      "File::",
      "var_os",
      "env::var",
      "dirs::",
    ]) {
      expect(body, bad).not.toContain(bad);
    }
  });
});

describe("WI3-T07: main.rs startup order", () => {
  it("logs app.launch, then migrates drafts, then builds the app", () => {
    const text = readBlankedRust("src/main.rs");
    const main = fnBody(text, "main");
    const launch = main.indexOf('"app.launch"');
    const migrate = main.indexOf("migrate_legacy_drafts_logged(");
    const builder = main.indexOf("tauri::Builder::default()");
    expect(launch).toBeGreaterThanOrEqual(0);
    expect(migrate).toBeGreaterThan(launch);
    expect(builder).toBeGreaterThan(migrate);
    expect(text).not.toContain("migrate_legacy_drafts(");
  });
});
