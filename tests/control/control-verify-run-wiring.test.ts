// @vitest-environment node
/**
 * ADR-0047 WI-002 / WI-4..WI-5: the source structure of the verify-run guard.
 * Matrix: `.claude/tdd-guardian/tests-20261003-061500.md` (r1), WI5-T11,
 * WI5-T12, WI5-T13, WI5-T15(b) and WI3-T07; WI5-T15(c) (WI-2) and WI5-T11,
 * WI5-T13 (recorded changes), WI5-T17 and WI5-T18 (WI-3) from the WI-002 fix
 * matrix `tests-20261007-230837.md`. The source readers live in
 * `tests/support/rustSource.ts` (moved there by the WI-002 fix,
 * `tests-20261007-230837.md`; no assertion changed).
 *
 * Structural on purpose: "the module is compiled only with the feature" is
 * not observable from the feature-off test binary, and the feature-on lane
 * cannot see what the feature-off build would contain. Sources are read
 * through `commentBlanker.mjs`, so a commented-out line never counts.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { blankComments } from "../../scripts/control/commentBlanker.mjs";
import {
  closureBody,
  codeLines,
  fnBody,
  readBlankedRust,
  rustFiles,
  SRC_TAURI,
} from "../support/rustSource";

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

const CFG_LINE = '#[cfg(feature = "verify-run")]';

/**
 * Recorded change (tests-20261007-230837.md, WI-3): `enforce` became
 * `enforce() -> VerifiedRun` (WI-2), so the call now binds `verified_run` for
 * `publish_or_exit` in the setup closure. The rest of the case is unchanged.
 */
const ENFORCE_CALL = "let verified_run = tauri_app_lib::services::verify_run::enforce();";
const PUBLISH_CALL =
  "tauri_app_lib::services::verify_run::publish_or_exit(&verified_run, BUILD_ID_RAW);";

describe("WI5-T11: the guard is the first statement of main()", () => {
  it("opens main() with the cfg-gated `let verified_run = …enforce();`, before startup and app.launch", () => {
    const main = fnBody(readBlankedRust("src/main.rs"), "main");
    expect(codeLines(main).slice(0, 2)).toEqual([CFG_LINE, ENFORCE_CALL]);
    const call = main.indexOf(ENFORCE_CALL);
    expect(call).toBeGreaterThanOrEqual(0);
    expect(main.indexOf("let startup")).toBeGreaterThan(call);
    expect(main.indexOf('"app.launch"')).toBeGreaterThan(call);
  });
});

describe("WI5-T17: publish_or_exit opens the setup closure, after the single-instance plugin", () => {
  const text = readBlankedRust("src/main.rs");
  const main = fnBody(text, "main");
  const closure = closureBody(main, /\.setup\(\s*move\s*\|\s*\w+\s*\|/);

  it("is the cfg-gated first statement of `.setup(move |app| {`", () => {
    expect(codeLines(closure).slice(0, 2)).toEqual([CFG_LINE, PUBLISH_CALL]);
  });

  it("comes before FileWatcher::new, app_controller_env( and \"app.ready\"", () => {
    const at = closure.indexOf("publish_or_exit(");
    expect(at).toBeGreaterThanOrEqual(0);
    for (const later of ["FileWatcher::new", "app_controller_env(", '"app.ready"']) {
      expect(closure.indexOf(later), later).toBeGreaterThan(at);
    }
  });

  it("sits in a builder chain that registers tauri_plugin_single_instance (order not asserted)", () => {
    const start = main.indexOf("tauri::Builder::default()");
    const end = main.indexOf(".build(tauri::generate_context!())");
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const chain = main.slice(start, end);
    expect(chain).toContain(".setup(");
    expect(chain).toContain(".plugin(tauri_plugin_single_instance::init(");
  });
});

describe("WI5-T18: Cargo.lock versions are in the read set of Findings 1-3", () => {
  const lock = fs.readFileSync(path.join(SRC_TAURI, "Cargo.lock"), "utf8");
  const versionsOf = (name: string): string[] =>
    lock
      .split("[[package]]")
      .filter((block) => new RegExp(`^\\s*name = "${name}"\\s*$`, "m").test(block))
      .map((block) => block.match(/^\s*version = "([^"]+)"\s*$/m)?.[1] ?? "<none>");

  it.each([
    ["tauri", ["2.9.5", "2.12.1"]],
    ["tauri-plugin-single-instance", ["2.3.7", "2.5.2"]],
  ])("%s is locked at a version whose setup ordering was read", (name, allowed) => {
    const found = versionsOf(name);
    expect(found.length, `${name} is in Cargo.lock`).toBeGreaterThan(0);
    for (const v of found) expect(allowed, `${name} ${v}`).toContain(v);
  });
});

const CONTROL_CFG_LINE = '#[cfg(feature = "control-channel")]';

describe("WI5-T13: no ungated verify_run reference outside services/verify_run*.rs", () => {
  // Recorded change (tests-20261007-230837.md, WI-3): main.rs gains the
  // cfg-gated `publish_or_exit` call in `.setup`, so two main.rs references.
  // Recorded change (ADR-0047 WI-009): services/control_channel/** is skipped
  // like services/verify_run*.rs. The whole module is compiled only under
  // `control-channel`, which implies `verify-run`; the next case pins both,
  // so its references are gated without a per-line attribute.
  it("has exactly the mod.rs declaration and the two main.rs calls, each under the cfg", () => {
    const srcRoot = path.join(SRC_TAURI, "src");
    const found: string[] = [];
    for (const file of rustFiles(srcRoot)) {
      const rel = path.relative(srcRoot, file).split(path.sep).join("/");
      if (/^services\/verify_run[^/]*\.rs$/.test(rel)) continue;
      if (rel.startsWith("services/control_channel/")) continue;
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
    expect(found.sort()).toEqual([
      `main.rs|${CFG_LINE}`,
      `main.rs|${CFG_LINE}`,
      `services/mod.rs|${CFG_LINE}`,
    ]);
  });

  it("compiles services/control_channel only under a feature that implies verify-run", () => {
    const lines = codeLines(readBlankedRust("src/services/mod.rs"));
    const at = lines.indexOf("pub mod control_channel;");
    expect(at, "services/mod.rs declares `pub mod control_channel;`").toBeGreaterThan(0);
    expect(lines[at - 1]).toBe(CONTROL_CFG_LINE);
    const toml = fs.readFileSync(path.join(SRC_TAURI, "Cargo.toml"), "utf8");
    const entries = (tomlTable(toml, "features") ?? []).map((l) => l.replace(/\s+/g, ""));
    expect(entries).toContain('control-channel=["verify-run"]');
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

/** Rust keywords that can precede `(`, `)` or `,` in an expression body. */
const RUST_KEYWORDS = new Set([
  "if", "else", "match", "while", "for", "loop", "in", "let", "mut", "ref", "move",
  "return", "as", "fn", "self", "true", "false", "break", "continue", "unsafe", "where",
]);

/** The minimal callees of "validate, or one stderr line plus exit 78". */
const ENFORCE_ALLOWED = new Set([
  "guard_inputs", "and_then", "check", "Ok", "Err", "writeln", "stderr", "rejection_line", "exit",
]);

/** Combinators whose argument must be a closure literal, never a fn passed by name. */
const COMBINATORS = ["and_then", "map", "or_else", "map_err", "unwrap_or_else", "inspect"];

/** Lowercase identifiers in `text`. */
const lowerIdents = (text: string): string[] => text.match(/\b[a-z_][a-z0-9_]*\b/g) ?? [];

/**
 * Every local binding in `body`: identifiers inside `|…|`, on the left of `=>`
 * in a match arm (back to the arm's `{`, `}` or top-level `,`), and between
 * `let` and `=` (tuple and constructor patterns included).
 */
function bindings(body: string): Set<string> {
  const out = new Set<string>();
  for (const m of body.matchAll(/\|([^|]*)\|/g)) lowerIdents(m[1]).forEach((id) => out.add(id));
  for (const m of body.matchAll(/\blet\s+([^=;]*?)=(?!=)/g)) lowerIdents(m[1]).forEach((id) => out.add(id));
  for (const m of body.matchAll(/=>/g)) {
    let depth = 0;
    let i = (m.index ?? 0) - 1;
    for (; i >= 0; i--) {
      const c = body[i];
      if (c === ")" || c === "]") depth++;
      else if (c === "(" || c === "[") depth--;
      else if (depth === 0 && (c === "{" || c === "}" || c === ",")) break;
    }
    lowerIdents(body.slice(i + 1, m.index)).forEach((id) => out.add(id));
  }
  return out;
}

/** Why `body` is not a validation-only `enforce`; empty when it is. */
function enforceViolations(rawBody: string): string[] {
  const body = rawBody.replace(/"(?:[^"\\]|\\.)*"/g, '""');
  const bound = bindings(body);
  // CamelCase types/variants and SCREAMING_CASE constants both start uppercase.
  const exempt = (id: string) => RUST_KEYWORDS.has(id) || /^[A-Z]/.test(id) || bound.has(id);
  const out: string[] = [];
  for (const m of body.matchAll(/\b([A-Za-z_]\w*)\s*!?\s*\(/g)) {
    if (["if", "match", "while", "for"].includes(m[1])) continue;
    if (!ENFORCE_ALLOWED.has(m[1])) out.push(`callee ${m[1]} is not allowed`);
  }
  for (const m of body.matchAll(new RegExp(`\\b(${COMBINATORS.join("|")})\\s*\\(\\s*(\\S)`, "g"))) {
    if (m[2] !== "|") out.push(`${m[1]} takes a fn by name, not a closure literal`);
  }
  for (const m of body.matchAll(/\b([A-Za-z_]\w*)\s*[),]/g)) {
    const id = m[1];
    if (exempt(id) || ENFORCE_ALLOWED.has(id)) continue;
    out.push(`bare identifier ${id} is not a binding or an allowed name`);
  }
  return out;
}

/** The round-3 reference body: the correct shape of a validation-only `enforce`. */
const REFERENCE_ENFORCE = `
    match guard_inputs().and_then(|(parent, uid)| check(&parent, uid)) {
        Ok(v) => v,
        Err(e) => {
            let _ = writeln!(stderr(), "{}", rejection_line(&e));
            exit(GUARD_EXIT_CODE)
        }
    }
`;

describe("WI5-T15(c): enforce validates and does nothing else", () => {
  const src = readBlankedRust("src/services/verify_run.rs");

  it("self-check: the reference body passes the rule", () => {
    expect(enforceViolations(REFERENCE_ENFORCE)).toEqual([]);
  });

  it("self-check: the reference body with .and_then(publish_now) fails both by-name rules", () => {
    const bad = REFERENCE_ENFORCE.replace(
      "check(&parent, uid))",
      "check(&parent, uid)).and_then(publish_now)",
    );
    expect(bad).not.toBe(REFERENCE_ENFORCE);
    const v = enforceViolations(bad);
    expect(v).toContain("and_then takes a fn by name, not a closure literal");
    expect(v).toContain("bare identifier publish_now is not a binding or an allowed name");
  });

  it("enforce() -> VerifiedRun calls only the allowlist, guard_inputs and check once each", () => {
    expect(src).toMatch(/pub fn enforce\(\)\s*->\s*VerifiedRun/);
    const body = fnBody(src, "enforce");
    expect(enforceViolations(body)).toEqual([]);
    expect(body.match(/\bguard_inputs\s*\(/g) ?? []).toHaveLength(1);
    expect(body.match(/\bcheck\s*\(/g) ?? []).toHaveLength(1);
  });

  it("no guard source declares fn run", () => {
    for (const rel of [
      "src/services/verify_run.rs",
      "src/services/verify_run_checks.rs",
      "src/services/verify_run_instance.rs",
    ]) {
      expect(readBlankedRust(rel), rel).not.toMatch(/\bfn run\s*[(<]/);
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
