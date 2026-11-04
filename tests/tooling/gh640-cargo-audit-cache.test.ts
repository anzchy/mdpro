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
 * fallback. Only the daily job writes that entry: `actions/cache/save` right
 * after a miss install, before the audit, so a red audit still seeds it.
 * `ci.yml` only restores, so a pull-request run can never seed a binary that a
 * later run of the same PR would execute (round 1, gpt H1). A PR scope with no
 * entry falls back to master's, which the daily run wrote. The version check
 * catches a mismatched binary, not a tampered one with the right version
 * string. `cargo audit` itself, its `src-tauri` working directory (where
 * `.cargo/audit.toml` lives) and ADR-0107's place outside `ci-gate.needs` do
 * not change.
 */
import { spawnSync } from "node:child_process";
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
      steps(job(text, id)).forEach((step, i) => {
        const uses = usesOf(step);
        const saves = uses.startsWith("actions/cache@") || uses.startsWith("actions/cache/save@");
        const options = withOf(step);
        const cargoAudit = (scalar(options, "path") ?? "").includes("cargo-audit") || (scalar(options, "key") ?? "").startsWith("cargo-audit-");
        if (saves && (id === "rust-audit" || cargoAudit)) savers.push(`${id} step ${i}`);
      });
    }
    expect(savers).toEqual([]);
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
          const uses = usesOf(step);
          if (!uses.startsWith("actions/cache@") && !uses.startsWith("actions/cache/save@")) return;
          const options = withOf(step);
          if ((scalar(options, "path") ?? "").includes("cargo-audit") || (scalar(options, "key") ?? "").startsWith("cargo-audit-")) {
            savers.push(`${file} ${id} step ${i}`);
          }
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
    expect(scalar(save, "if")).toBe(scalar(s.all[s.install[0]], "if"));
    expect(scalar(save, "if")).toBe(`steps.${scalar(s.all[s.restore[0]], "id")}.outputs.cache-hit != 'true'`);
    expect(s.save[0]).toBe(s.install[0] + 1);
    expect(ascending([s.toolchain, s.restore[0], s.install[0], s.save[0], s.check[0], s.audit[0]])).toBe(true);
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

  const runCheck = (file: string, out: string, rc = 0) => {
    const s = auditSteps(read(file));
    // A missing step must fail the case, not pass it as a non-zero exit.
    expect(s.check, `${file} has one version-check step`).toHaveLength(1);
    const script = stepRun(s.all[s.check[0]]) ?? "";
    return spawnSync("bash", [...GITHUB_BASH, "-c", script], {
      env: { PATH: `${dir}:${process.env.PATH ?? ""}`, CARGO_AUDIT_VERSION: PINNED, FAKE_OUT: out, FAKE_RC: String(rc) },
      encoding: "utf8",
    }).status;
  };

  it.each(FILES)("%s: passes the pinned version", (file) => {
    expect(runCheck(file, `cargo-audit-audit ${PINNED}`)).toBe(0);
  });

  it.each(FILES)("%s: fails another version, a lookalike, an empty answer or a failing binary", (file) => {
    for (const out of ["cargo-audit-audit 0.22.1", "cargo-audit-audit 0.22.20", "cargo-audit-audit 0.22.2-rc1", `cargo-audit ${PINNED}`, ""]) {
      expect(runCheck(file, out), out).not.toBe(0);
    }
    expect(runCheck(file, `cargo-audit-audit ${PINNED}`, 1)).not.toBe(0);
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
