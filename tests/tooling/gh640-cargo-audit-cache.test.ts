// @vitest-environment node
/**
 * GH640 (AC-2 of the GH638 brief; fix 1's AC-F1 and AC-F2): `rust-audit`
 * restores a pinned cargo-audit binary from the cache, compiles it only on a
 * miss, and checks its version before the audit runs.
 *
 * `cargo install cargo-audit --locked` took 137–172 s on every run. Both
 * `ci.yml` and `rust-audit-daily.yml` pin `CARGO_AUDIT_VERSION` at the
 * workflow level and restore `~/.cargo/bin/cargo-audit` (the one binary, not
 * the rustup proxies beside it) under a key of OS and version with no prefix
 * fallback. `ci.yml` only restores. Master's entry is written only by the
 * daily job on master: `actions/cache/save` right after a miss install, before
 * the audit (so a red audit still seeds it), and only when `github.ref` is
 * master (fix 2, gpt r2 F1), so a dispatch on another branch never seeds that
 * branch's scope. A PR scope with no entry falls back to master's. A PR's own
 * earlier revisions can still write its own scope; that residual is accepted
 * and tracked on #645, and no workflow text in the base can close it. The version check
 * catches a mismatched binary, not a tampered one with the right version
 * string. `cargo audit` itself, its `src-tauri` working directory (where
 * `.cargo/audit.toml` lives) and ADR-0107's place outside `ci-gate.needs` do
 * not change.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { entry, job, jobIds, keys, list, scalar, stepRun, steps, topLevel } from "../support/workflowBlocks";

const ROOT = path.resolve(__dirname, "..", "..");
const WORKFLOWS = path.join(ROOT, ".github", "workflows");
const FILES = ["ci.yml", "rust-audit-daily.yml"] as const;
const read = (name: string) => fs.readFileSync(path.join(WORKFLOWS, name), "utf8");

const PINNED = "0.22.2";
const CACHE_PATH = "~/.cargo/bin/cargo-audit";
const CACHE_KEY = "cargo-audit-${{ runner.os }}-${{ env.CARGO_AUDIT_VERSION }}";
const INSTALL = 'cargo install cargo-audit --locked --version "$CARGO_AUDIT_VERSION"';
const RESTORE = "actions/cache/restore@v4";
const SAVE = "actions/cache/save@v4";
// `cargo audit --version` goes through cargo's subcommand dispatch, the same path
// `cargo audit` takes, and cargo-audit 0.22.2 answers it as `cargo-audit-audit 0.22.2`
// (checked on a local `cargo install --locked --version 0.22.2`; the bare binary says
// `cargo-audit 0.22.2`).
const VERSION_CHECK = [
  'actual="$(cargo audit --version)"',
  'echo "$actual"',
  'test "$actual" = "cargo-audit-audit $CARGO_AUDIT_VERSION"',
].join("\n");
// GitHub's shell for a Linux `run` step with no `shell` key: `bash -e {0}`.
const GITHUB_BASH = ["-e"];
const FAKE_ARGS_MISMATCH = 97;

const MASTER_ONLY = "github.ref == 'refs/heads/master'";

const withOf = (step: string | undefined) => entry(step ?? null, "with")?.body ?? null;
const ownKeys = (step: string) => keys(step).filter((k) => k !== "name").sort();
const usesOf = (step: string) => scalar(step, "uses") ?? "";

/** Every place in a workflow that defines an env var: workflow, job and step `env` blocks. */
function envDefinitions(text: string, name: string): string[] {
  const out: string[] = [];
  if (keys(topLevel(text, "env")).includes(name)) out.push("workflow");
  for (const id of jobIds(text)) {
    const j = job(text, id);
    if (keys(topLevel(j, "env")).includes(name)) out.push(`job ${id}`);
    steps(j).forEach((s, i) => {
      if (keys(topLevel(s, "env")).includes(name)) out.push(`job ${id} step ${i}`);
    });
  }
  return out;
}

const indexesWhere = (all: string[], pred: (s: string) => boolean) => all.flatMap((s, i) => (pred(s) ? [i] : []));

function auditSteps(text: string) {
  const all = steps(job(text, "rust-audit"));
  return {
    all,
    toolchain: all.findIndex((s) => usesOf(s) === "dtolnay/rust-toolchain@stable"),
    cacheAny: indexesWhere(all, (s) => usesOf(s).startsWith("actions/cache")),
    restore: indexesWhere(all, (s) => usesOf(s).startsWith("actions/cache/restore@")),
    save: indexesWhere(all, (s) => usesOf(s).startsWith("actions/cache/save@")),
    install: indexesWhere(all, (s) => stepRun(s)?.includes("cargo install cargo-audit") ?? false),
    check: indexesWhere(all, (s) => stepRun(s)?.includes("cargo audit --version") ?? false),
    audit: indexesWhere(all, (s) => stepRun(s) === "cargo audit"),
  };
}

/**
 * Whether a step writes a cargo-audit entry or anything under `.cargo/bin`: an
 * `actions/cache@` or `actions/cache/save@` step whose path (inline or block)
 * names either, or whose key starts `cargo-audit-`.
 */
function savesCargoAudit(step: string): boolean {
  const uses = usesOf(step);
  if (!uses.startsWith("actions/cache@") && !uses.startsWith("actions/cache/save@")) return false;
  const options = withOf(step);
  const p = entry(options, "path");
  const pathText = p ? (p.inline ?? p.body) : "";
  return pathText.includes("cargo-audit") || pathText.includes(".cargo/bin") || (scalar(options, "key") ?? "").startsWith("cargo-audit-");
}

/** Evaluates `<ctx> == '<v>'` / `<ctx> != '<v>'` terms joined by `&&`; anything else throws. */
function evaluateIf(expr: string, ctx: Record<string, string>): boolean {
  return expr.split(" && ").every((term) => {
    const m = /^([a-z][a-z0-9_.-]*) (==|!=) '([^']*)'$/.exec(term);
    if (!m || !(m[1] in ctx)) throw new Error(`unsupported if term: ${term}`);
    return m[2] === "==" ? ctx[m[1]] === m[3] : ctx[m[1]] !== m[3];
  });
}

const ascending = (xs: number[]) => xs.every((x, i) => i === 0 || xs[i - 1] < x);

describe.each(FILES)("GH640 %s rust-audit restores a pinned cargo-audit", (file) => {
  const text = read(file);

  it("pins CARGO_AUDIT_VERSION once, at the workflow level, to an exact version", () => {
    expect(scalar(topLevel(text, "env"), "CARGO_AUDIT_VERSION")).toBe(PINNED);
    expect(envDefinitions(text, "CARGO_AUDIT_VERSION")).toEqual(["workflow"]);
  });

  it("restores only the cargo-audit binary with actions/cache/restore@v4, keyed by OS and version, with no prefix fallback", () => {
    const s = auditSteps(text);
    expect(s.restore).toHaveLength(1);
    const restore = s.all[s.restore[0]];
    expect(usesOf(restore)).toBe(RESTORE);
    expect(scalar(restore, "id")).toMatch(/^[A-Za-z_][A-Za-z0-9_-]*$/);
    // No step `if`, `continue-on-error`, `lookup-only` or `fail-on-cache-miss`:
    // each would skip the restore or hide its failure while cache-hit still steers the install.
    expect(ownKeys(restore)).toEqual(["id", "uses", "with"]);
    const options = withOf(restore);
    expect(keys(options).sort()).toEqual(["key", "path"]);
    expect(scalar(options, "path")).toBe(CACHE_PATH);
    expect(scalar(options, "key")).toBe(CACHE_KEY);
  });

  it("installs the pinned version with --locked only when the cache missed", () => {
    const s = auditSteps(text);
    expect(s.install).toHaveLength(1);
    const install = s.all[s.install[0]];
    const cacheId = scalar(s.all[s.restore[0]], "id");
    expect(stepRun(install)).toBe(INSTALL);
    expect(scalar(install, "if")).toBe(`steps.${cacheId}.outputs.cache-hit != 'true'`);
  });

  it("checks the binary's version, unconditionally, before the audit", () => {
    const s = auditSteps(text);
    expect(s.check).toHaveLength(1);
    const check = s.all[s.check[0]];
    // Only `run`: no `if`, `continue-on-error`, `working-directory` or `shell` override.
    expect(ownKeys(check)).toEqual(["run"]);
    expect(stepRun(check)?.trimEnd()).toBe(VERSION_CHECK);
    expect(scalar(job(text, "rust-audit"), "continue-on-error")).toBeNull();
  });

  it("still runs plain `cargo audit` in src-tauri, unconditionally, and may fail its run", () => {
    const s = auditSteps(text);
    expect(s.audit).toHaveLength(1);
    const audit = s.all[s.audit[0]];
    expect(scalar(audit, "working-directory")).toBe("src-tauri");
    expect(scalar(audit, "if")).toBeNull();
    expect(scalar(audit, "continue-on-error")).toBeNull();
    expect(scalar(job(text, "rust-audit"), "continue-on-error")).toBeNull();
    expect(scalar(job(text, "rust-audit"), "runs-on")).toBe("ubuntu-latest");
    expect(fs.existsSync(path.join(ROOT, "src-tauri", ".cargo", "audit.toml"))).toBe(true);
  });
});

describe("GH640 ci.yml never writes the cargo-audit cache", () => {
  const text = read("ci.yml");

  it("orders toolchain, restore, install, version check, then the audit, and has no other cache step", () => {
    const s = auditSteps(text);
    expect(s.cacheAny).toEqual(s.restore);
    expect(s.save).toEqual([]);
    expect(s.toolchain).toBeGreaterThanOrEqual(0);
    expect(ascending([s.toolchain, s.restore[0], s.install[0], s.check[0], s.audit[0]])).toBe(true);
  });

  it("has no saving cache step for cargo-audit in any job", () => {
    const savers: string[] = [];
    for (const id of jobIds(text)) {
      // rust-audit's own steps are also pinned to restore-only by the ordering case above.
      steps(job(text, id)).forEach((step, i) => savesCargoAudit(step) && savers.push(`${id} step ${i}`));
    }
    expect(savers).toEqual([]);
  });
});

describe("GH640 the saver scan flags any .cargo/bin save, whatever its key", () => {
  const step = (uses: string, pathLines: string, key = "tools-x") => `uses: ${uses}\nwith:\n${pathLines}\n  key: ${key}`;
  it.each([
    ["a block path", step("actions/cache@v4", "  path: |\n    ~/.cargo/registry\n    ~/.cargo/bin"), true],
    ["a folded path on save", step("actions/cache/save@v4", "  path: >-\n    ~/.cargo/bin"), true],
    ["an expression key", step("actions/cache/save@v4", "  path: ~/.cargo/bin/cargo-audit", "${{ env.K }}"), true],
    ["$HOME", step("actions/cache@v4", "  path: $HOME/.cargo/bin/cargo-audit"), true],
    ["an absolute home", step("actions/cache/save@v4", "  path: /home/runner/.cargo/bin/cargo-audit"), true],
    ["rust-test's cache", step("actions/cache@v4", "  path: |\n    ~/.cargo/registry\n    ~/.cargo/git\n    src-tauri/target", "rust-test-x"), false],
    ["a restore", step("actions/cache/restore@v4", "  path: ~/.cargo/bin/cargo-audit"), false],
  ] as const)("%s", (_name, text, flagged) => {
    expect(savesCargoAudit(text)).toBe(flagged);
  });
});

describe("GH640 rust-audit-daily.yml is the one writer", () => {
  const text = read("rust-audit-daily.yml");

  it("is the only step in any workflow that saves the cargo-audit entry", () => {
    const savers: string[] = [];
    for (const file of fs.readdirSync(WORKFLOWS).filter((f) => /\.ya?ml$/.test(f)).sort()) {
      const workflow = read(file);
      for (const id of jobIds(workflow)) {
        steps(job(workflow, id)).forEach((step, i) => {
          if (savesCargoAudit(step)) savers.push(`${file} ${id} step ${i}`);
        });
      }
    }
    expect(savers).toEqual([`rust-audit-daily.yml rust-audit step ${auditSteps(text).save[0]}`]);
  });

  it("saves exactly once, with actions/cache/save@v4, right after a miss install and before the audit", () => {
    const s = auditSteps(text);
    expect(s.save).toHaveLength(1);
    expect(s.cacheAny.sort((a, b) => a - b)).toEqual([s.restore[0], s.save[0]].sort((a, b) => a - b));
    const save = s.all[s.save[0]];
    expect(usesOf(save)).toBe(SAVE);
    expect(ownKeys(save)).toEqual(["if", "uses", "with"]);
    const miss = `steps.${scalar(s.all[s.restore[0]], "id")}.outputs.cache-hit != 'true'`;
    expect(scalar(s.all[s.install[0]], "if")).toBe(miss);
    expect(scalar(save, "if")).toBe(`${miss} && ${MASTER_ONLY}`);
    expect(s.save[0]).toBe(s.install[0] + 1);
    expect(ascending([s.toolchain, s.restore[0], s.install[0], s.save[0], s.check[0], s.audit[0]])).toBe(true);
  });

  it("saves only on a miss on master; any other ref or a hit never saves", () => {
    const s = auditSteps(text);
    const id = scalar(s.all[s.restore[0]], "id");
    const expr = scalar(s.all[s.save[0]], "if") ?? "";
    const hit = `steps.${id}.outputs.cache-hit`;
    const saved: string[] = [];
    for (const cacheHit of ["true", "", "false"])
      for (const ref of ["refs/heads/master", "refs/heads/feature", "refs/pull/643/merge", "refs/tags/v1"])
        if (evaluateIf(expr, { [hit]: cacheHit, "github.ref": ref })) saved.push(`${cacheHit || "(unset)"} ${ref}`);
    expect(saved).toEqual(["(unset) refs/heads/master", "false refs/heads/master"]);
  });

  it("saves the same path and key it restores", () => {
    const s = auditSteps(text);
    const restore = withOf(s.all[s.restore[0]]);
    const save = withOf(s.all[s.save[0]]);
    expect(keys(save).sort()).toEqual(["key", "path"]);
    expect([scalar(save, "path"), scalar(save, "key")]).toEqual([scalar(restore, "path"), scalar(restore, "key")]);
  });

  it("is written only by its schedule and manual dispatch", () => {
    expect(keys(topLevel(text, "on")).sort()).toEqual(["schedule", "workflow_dispatch"]);
  });
});

describe("GH640 the version check rejects anything but the pinned version", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh640-fake-cargo-"));
  const fake = path.join(dir, "cargo");
  fs.writeFileSync(
    fake,
    `#!/bin/sh\nif [ "$*" = "audit --version" ]; then printf '%s\\n' "$FAKE_OUT"; exit "$FAKE_RC"; fi\nexit ${FAKE_ARGS_MISMATCH}\n`,
    { mode: 0o755 },
  );
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  /** The step's exit code, run asynchronously (the conditional-tests lint bars sync child calls). */
  const runCheck = (file: string, out: string, rc = 0): Promise<number | null> => {
    const s = auditSteps(read(file));
    // A missing step must fail the case, not pass it as a non-zero exit.
    expect(s.check, `${file} has one version-check step`).toHaveLength(1);
    const script = stepRun(s.all[s.check[0]]) ?? "";
    return new Promise((resolve, reject) => {
      const child = spawn("bash", [...GITHUB_BASH, "-c", script], {
        env: { PATH: `${dir}:${process.env.PATH ?? ""}`, CARGO_AUDIT_VERSION: PINNED, FAKE_OUT: out, FAKE_RC: String(rc) },
        stdio: "ignore",
      });
      child.on("error", reject);
      child.on("close", resolve);
    });
  };

  it.each(FILES)("%s: passes the pinned version", async (file) => {
    expect(await runCheck(file, `cargo-audit-audit ${PINNED}`)).toBe(0);
  });

  it.each(FILES)("%s: fails another version, a lookalike, an empty answer or a failing binary", async (file) => {
    for (const out of ["cargo-audit-audit 0.22.1", "cargo-audit-audit 0.22.20", "cargo-audit-audit 0.22.2-rc1", `cargo-audit ${PINNED}`, ""]) {
      expect(await runCheck(file, out), out).not.toBe(0);
    }
    expect(await runCheck(file, `cargo-audit-audit ${PINNED}`, 1)).not.toBe(0);
  });
});

describe("GH640 the two workflows share one cache", () => {
  it("uses the same version, path and key in ci.yml and rust-audit-daily.yml", () => {
    const shape = (file: string) => {
      const text = read(file);
      const s = auditSteps(text);
      const options = withOf(s.all[s.restore[0]]);
      return [scalar(topLevel(text, "env"), "CARGO_AUDIT_VERSION"), scalar(options, "path"), scalar(options, "key")];
    };
    expect(shape("ci.yml")).toEqual(shape("rust-audit-daily.yml"));
  });

  it("keeps rust-audit out of ci-gate.needs (ADR-0107)", () => {
    expect(list(job(read("ci.yml"), "ci-gate"), "needs")).toEqual(["scope", "prose-checks", "frontend", "rust-test"]);
  });
});
