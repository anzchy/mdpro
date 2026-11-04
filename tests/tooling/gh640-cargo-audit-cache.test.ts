// @vitest-environment node
/**
 * GH640 (AC-2 of the GH638 brief): `rust-audit` restores a pinned cargo-audit
 * binary from `actions/cache@v4` and compiles it only on a miss.
 *
 * `cargo install cargo-audit --locked` took 137–172 s on every run. Both
 * `ci.yml` and `rust-audit-daily.yml` now pin `CARGO_AUDIT_VERSION` at the
 * workflow level, cache `~/.cargo/bin/cargo-audit` (the one binary, not the
 * rustup proxies beside it) under a key of OS and version with no prefix
 * fallback, and install with `--locked --version` only when the cache missed.
 * The two files share path and key, so the daily run on master seeds the cache
 * that pull-request runs restore (ci.yml never runs on master). `cargo audit`
 * itself, its `src-tauri` working directory (where `.cargo/audit.toml` lives)
 * and ADR-0107's place outside `ci-gate.needs` do not change.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { entry, job, jobIds, keys, list, scalar, stepRun, steps, topLevel } from "../support/workflowBlocks";

const ROOT = path.resolve(__dirname, "..", "..");
const WORKFLOWS = path.join(ROOT, ".github", "workflows");
const FILES = ["ci.yml", "rust-audit-daily.yml"] as const;
const read = (name: string) => fs.readFileSync(path.join(WORKFLOWS, name), "utf8");

const PINNED = "0.22.2";
const CACHE_PATH = "~/.cargo/bin/cargo-audit";
const CACHE_KEY = "cargo-audit-${{ runner.os }}-${{ env.CARGO_AUDIT_VERSION }}";
const INSTALL = 'cargo install cargo-audit --locked --version "$CARGO_AUDIT_VERSION"';

const withOf = (step: string | undefined) => entry(step ?? null, "with")?.body ?? null;

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

function auditSteps(text: string) {
  const all = steps(job(text, "rust-audit"));
  const index = (pred: (s: string) => boolean) => all.findIndex(pred);
  return {
    all,
    toolchain: index((s) => scalar(s, "uses") === "dtolnay/rust-toolchain@stable"),
    cache: all.flatMap((s, i) => (scalar(s, "uses")?.startsWith("actions/cache") ? [i] : [])),
    install: all.flatMap((s, i) => (stepRun(s)?.includes("cargo install cargo-audit") ? [i] : [])),
    audit: all.flatMap((s, i) => (stepRun(s)?.includes("cargo audit") && !stepRun(s)?.includes("cargo install") ? [i] : [])),
  };
}

describe.each(FILES)("GH640 %s rust-audit caches a pinned cargo-audit", (file) => {
  const text = read(file);

  it("pins CARGO_AUDIT_VERSION once, at the workflow level, to an exact version", () => {
    expect(scalar(topLevel(text, "env"), "CARGO_AUDIT_VERSION")).toBe(PINNED);
    expect(envDefinitions(text, "CARGO_AUDIT_VERSION")).toEqual(["workflow"]);
  });

  it("restores only the cargo-audit binary from actions/cache@v4, keyed by OS and version, with no prefix fallback", () => {
    const s = auditSteps(text);
    expect(s.cache).toHaveLength(1);
    const cache = s.all[s.cache[0]];
    expect(scalar(cache, "uses")).toBe("actions/cache@v4");
    expect(scalar(cache, "id")).toMatch(/^[A-Za-z_][A-Za-z0-9_-]*$/);
    // No step `if`, `continue-on-error`, `lookup-only` or `fail-on-cache-miss`:
    // each would skip the restore or hide its failure while cache-hit still steers the install.
    expect(keys(cache).filter((k) => k !== "name").sort()).toEqual(["id", "uses", "with"]);
    const options = withOf(cache);
    expect(keys(options).sort()).toEqual(["key", "path"]);
    expect(scalar(options, "path")).toBe(CACHE_PATH);
    expect(scalar(options, "key")).toBe(CACHE_KEY);
  });

  it("installs the pinned version with --locked only when the cache missed", () => {
    const s = auditSteps(text);
    expect(s.install).toHaveLength(1);
    const install = s.all[s.install[0]];
    const cacheId = scalar(s.all[s.cache[0]], "id");
    expect(stepRun(install)).toBe(INSTALL);
    expect(scalar(install, "if")).toBe(`steps.${cacheId}.outputs.cache-hit != 'true'`);
  });

  it("orders toolchain, cache, install, then the audit", () => {
    const s = auditSteps(text);
    expect(s.audit).toHaveLength(1);
    expect(s.toolchain).toBeGreaterThanOrEqual(0);
    expect([s.toolchain, s.cache[0], s.install[0], s.audit[0]]).toEqual(
      [s.toolchain, s.cache[0], s.install[0], s.audit[0]].slice().sort((a, b) => a - b),
    );
    expect(new Set([s.toolchain, s.cache[0], s.install[0], s.audit[0]]).size).toBe(4);
  });

  it("still runs plain `cargo audit` in src-tauri, unconditionally, and may fail its run", () => {
    const s = auditSteps(text);
    const audit = s.all[s.audit[0]];
    expect(stepRun(audit)).toBe("cargo audit");
    expect(scalar(audit, "working-directory")).toBe("src-tauri");
    expect(scalar(audit, "if")).toBeNull();
    expect(scalar(audit, "continue-on-error")).toBeNull();
    expect(scalar(job(text, "rust-audit"), "continue-on-error")).toBeNull();
    expect(scalar(job(text, "rust-audit"), "runs-on")).toBe("ubuntu-latest");
    expect(fs.existsSync(path.join(ROOT, "src-tauri", ".cargo", "audit.toml"))).toBe(true);
  });
});

describe("GH640 the two workflows share one cache", () => {
  it("uses the same version, path and key in ci.yml and rust-audit-daily.yml", () => {
    const shape = (file: string) => {
      const text = read(file);
      const s = auditSteps(text);
      const options = withOf(s.all[s.cache[0]]);
      return [scalar(topLevel(text, "env"), "CARGO_AUDIT_VERSION"), scalar(options, "path"), scalar(options, "key")];
    };
    expect(shape("ci.yml")).toEqual(shape("rust-audit-daily.yml"));
  });

  it("keeps rust-audit out of ci-gate.needs (ADR-0107)", () => {
    expect(list(job(read("ci.yml"), "ci-gate"), "needs")).toEqual(["scope", "prose-checks", "frontend", "rust-test"]);
  });
});
