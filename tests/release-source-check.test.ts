// @vitest-environment node
/**
 * D76-WI-1: `checkSource` — the release preflight's source / tag / version
 * consistency check (requirement ②), and its thin CLI `check-source.mjs`.
 * Plan: `.claude/tdd-guardian/plan-d76-20261010-141631.md`, cases S1..S13.
 *
 * Law: the draft-mode version gate is a strict total order on patch numbers
 * within one major.minor — `expected > latest` is accepted exactly when the
 * patch is numerically greater (S10 property, seeded).
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GitSandbox } from "./helpers/controlGitRepo";
import { int, mulberry32 } from "./support/seededRandom";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { checkSource, parseCargoPackageVersion } from "../scripts/release/sourceCheck.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { main as checkSourceMain } from "../scripts/release/check-source.mjs";

type Result = { ok: boolean; errors: string[]; warnings: string[]; sha: string | null; tag: string | null };
const check = (facts: unknown): Result => checkSource(facts);

const HEAD = "a".repeat(40);
const OTHER = "b".repeat(40);
const PKG = "package.json";
const CONF = "src-tauri/tauri.conf.json";
const CARGO = "src-tauri/Cargo.toml";

const base = (over: Record<string, unknown> = {}) => ({
  mode: "draft",
  refInput: HEAD,
  expectedVersion: "0.3.1",
  headSha: HEAD,
  refSha: HEAD,
  versions: { packageJson: "0.3.1", tauriConf: "0.3.1", cargoToml: "0.3.1" },
  tagSha: null,
  existingRelease: null,
  latestPublished: "v0.3.0",
  ...over,
});

const all = (r: Result) => r.errors.join("\n");

describe("checkSource — happy paths", () => {
  it("S1 explicit SHA ref, draft mode, no tag, no release, latest 0.3.0, version 0.3.1 → ok", () => {
    const r = check(base());
    expect(r).toEqual({ ok: true, errors: [], warnings: [], sha: HEAD, tag: "v0.3.1" });
  });

  it("S2 tag ref v0.3.1 whose peeled tagSha equals headSha → ok", () => {
    const r = check(base({ refInput: "v0.3.1", tagSha: HEAD }));
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.sha).toBe(HEAD);
    expect(r.tag).toBe("v0.3.1");
  });
});

describe("checkSource — file versions", () => {
  it("S3 package.json 0.3.1 but Cargo.toml 0.3.0 → one error naming src-tauri/Cargo.toml only", () => {
    const r = check(base({ versions: { packageJson: "0.3.1", tauriConf: "0.3.1", cargoToml: "0.3.0" } }));
    expect(r.ok).toBe(false);
    expect(r.errors.filter((e) => e.includes(CARGO))).toHaveLength(1);
    expect(all(r)).not.toContain(PKG);
    expect(all(r)).not.toContain(CONF);
  });

  it.each([
    ["packageJson", PKG],
    ["tauriConf", CONF],
    ["cargoToml", CARGO],
  ])("S4 only %s differs → exactly that file (%s) is named", (key, file) => {
    const versions = { packageJson: "0.3.1", tauriConf: "0.3.1", cargoToml: "0.3.1", [key]: "0.3.0" };
    const r = check(base({ versions }));
    expect(r.ok).toBe(false);
    const named = [PKG, CONF, CARGO].filter((f) => all(r).includes(f));
    expect(named).toEqual([file]);
  });

  it("S4b all three differ → every file is named", () => {
    const r = check(base({ versions: { packageJson: "0.3.0", tauriConf: "0.2.9", cargoToml: null } }));
    expect(r.ok).toBe(false);
    for (const f of [PKG, CONF, CARGO]) expect(all(r)).toContain(f);
  });
});

describe("checkSource — ref must be explicit", () => {
  it("S5 tag ref v0.3.2 with version 0.3.1 (tag ≠ version) → error", () => {
    const r = check(base({ refInput: "v0.3.2" }));
    expect(r.ok).toBe(false);
    expect(all(r)).toMatch(/explicit SHA or tag/);
  });

  it.each(["master", "fix/x", "aaaaaaa", "", "A".repeat(40), `${HEAD}0`])(
    "S6 ref %j is not an explicit SHA or the version tag → error",
    (refInput) => {
      const r = check(base({ refInput }));
      expect(r.ok).toBe(false);
      expect(all(r)).toMatch(/explicit SHA or tag/);
    },
  );

  it("S7 headSha ≠ refSha (checkout is not the requested commit) → error", () => {
    const r = check(base({ refSha: OTHER }));
    expect(r.ok).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.sha).toBeNull();
  });
});

describe("checkSource — existing tags and releases", () => {
  it("S8 draft: tag exists at another SHA → error", () => {
    const r = check(base({ tagSha: OTHER }));
    expect(r.ok).toBe(false);
    expect(all(r)).toContain("v0.3.1");
  });

  it.each(["build-only", "rehearsal-draft"])("S8 %s: tag at another SHA → warning only, ok", (mode) => {
    const r = check(base({ mode, tagSha: OTHER }));
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.warnings.join("\n")).toContain("v0.3.1");
  });

  it("S9 draft: a published release already on the tag (the v0.3.0 situation) → error", () => {
    const r = check(base({ existingRelease: { isDraft: false } }));
    expect(r.ok).toBe(false);
    expect(all(r)).toMatch(/release/i);
  });

  it("S9 draft: an existing draft on the tag → error", () => {
    const r = check(base({ existingRelease: { isDraft: true } }));
    expect(r.ok).toBe(false);
    expect(all(r)).toMatch(/release/i);
  });

  it.each(["build-only", "rehearsal-draft"])("S9 %s: an existing published release → warning only, ok", (mode) => {
    const r = check(base({ mode, existingRelease: { isDraft: false }, expectedVersion: "0.3.1" }));
    expect(r.ok).toBe(true);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it("S8c build-only still errors on a file/version mismatch", () => {
    const r = check(base({ mode: "build-only", versions: { packageJson: "0.3.1", tauriConf: "0.3.0", cargoToml: "0.3.1" } }));
    expect(r.ok).toBe(false);
    expect(all(r)).toContain(CONF);
  });

  it.each(["draft", "build-only", "rehearsal-draft"])(
    "S8e %s: each single-file version mismatch is an error in every mode",
    (mode) => {
      for (const [key, file] of [
        ["packageJson", PKG],
        ["tauriConf", CONF],
        ["cargoToml", CARGO],
      ]) {
        const versions = { packageJson: "0.3.1", tauriConf: "0.3.1", cargoToml: "0.3.1", [key]: "0.3.0" };
        const r = check(base({ mode, versions }));
        expect(r.ok, `${mode} ${file}`).toBe(false);
        expect(all(r)).toContain(file);
      }
    },
  );

  it("S8d build-only still errors when headSha ≠ refSha", () => {
    expect(check(base({ mode: "build-only", refSha: OTHER })).ok).toBe(false);
  });
});

describe("checkSource — draft version gate (ADR-0069)", () => {
  it("S10 version 0.3.0 with latest 0.3.0 → error (not greater)", () => {
    const r = check(
      base({ expectedVersion: "0.3.0", versions: { packageJson: "0.3.0", tauriConf: "0.3.0", cargoToml: "0.3.0" } }),
    );
    expect(r.ok).toBe(false);
  });

  it("S10 version 0.4.0 with latest 0.3.0 → error (minor change)", () => {
    const r = check(
      base({ expectedVersion: "0.4.0", versions: { packageJson: "0.4.0", tauriConf: "0.4.0", cargoToml: "0.4.0" } }),
    );
    expect(r.ok).toBe(false);
  });

  it("S10 version 0.3.10 with latest 0.3.9 → ok (numeric, not string, compare)", () => {
    const r = check(
      base({
        expectedVersion: "0.3.10",
        latestPublished: "v0.3.9",
        versions: { packageJson: "0.3.10", tauriConf: "0.3.10", cargoToml: "0.3.10" },
      }),
    );
    expect(r.ok).toBe(true);
  });

  it("S10b draft with no published release to compare against → error", () => {
    expect(check(base({ latestPublished: null })).ok).toBe(false);
  });

  it("S10c build-only does not need a latest published release", () => {
    expect(check(base({ mode: "build-only", latestPublished: null })).ok).toBe(true);
  });

  it("S10 property (seed 76): draft accepts exactly patch > latest patch, same major.minor", () => {
    const r = mulberry32(76);
    for (let i = 0; i < 300; i++) {
      const major = int(r, 0, 3);
      const minor = int(r, 0, 12);
      const latestPatch = int(r, 0, 30);
      const patch = int(r, 0, 30);
      const v = `${major}.${minor}.${patch}`;
      const res = check(
        base({
          expectedVersion: v,
          latestPublished: `v${major}.${minor}.${latestPatch}`,
          versions: { packageJson: v, tauriConf: v, cargoToml: v },
        }),
      );
      expect(res.ok, `${v} vs ${major}.${minor}.${latestPatch}`).toBe(patch > latestPatch);
    }
  });
});

describe("checkSource — guard clauses", () => {
  it.each(["v0.3.1", "0.3.1-rc.1", "0.3", "", "0.3.1.2", " 0.3.1"])("S11 expectedVersion %j → error", (expectedVersion) => {
    const r = check(base({ expectedVersion }));
    expect(r.ok).toBe(false);
    expect(r.tag).toBeNull();
  });

  it.each([null, undefined, 42, "facts", [], {}])("never throws on malformed facts %j", (facts) => {
    let r: Result | undefined;
    expect(() => {
      r = check(facts);
    }).not.toThrow();
    expect(r?.ok).toBe(false);
    expect(r?.errors.length).toBeGreaterThan(0);
  });

  it("an unknown mode → error", () => {
    const r = check(base({ mode: "publish" }));
    expect(r.ok).toBe(false);
    expect(all(r)).toMatch(/mode/);
  });
});

describe("parseCargoPackageVersion", () => {
  it("S12 a dependency's version above [package] does not win", () => {
    const text = [
      "[dependencies]",
      'foo = { version = "9.9.9" }',
      'version = "8.8.8"',
      "",
      "[package]",
      'name = "mdpro"',
      'version = "0.3.1"',
      'edition = "2021"',
    ].join("\n");
    expect(parseCargoPackageVersion(text)).toBe("0.3.1");
  });

  it("S12 a dependency's version below [package] does not win", () => {
    const text = [
      "[package]",
      'name = "mdpro"',
      'version = "0.3.1"',
      "",
      "[dependencies]",
      'foo = { version = "9.9.9" }',
      "[dependencies.bar]",
      'version = "7.7.7"',
    ].join("\n");
    expect(parseCargoPackageVersion(text)).toBe("0.3.1");
  });

  it("S12b [package] without a version line → null, even when a later table has one", () => {
    const text = ['[package]', 'name = "mdpro"', "", "[dependencies.bar]", 'version = "7.7.7"'].join("\n");
    expect(parseCargoPackageVersion(text)).toBeNull();
  });

  it("S12c no [package] table, or non-string input → null", () => {
    expect(parseCargoPackageVersion('[dependencies]\nversion = "1.0.0"\n')).toBeNull();
    expect(parseCargoPackageVersion(undefined)).toBeNull();
  });

  it("reads the real src-tauri/Cargo.toml", () => {
    const text = fs.readFileSync(path.resolve(__dirname, "../src-tauri/Cargo.toml"), "utf8");
    expect(parseCargoPackageVersion(text)).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

// ---------------------------------------------------------------------------
// CLI against a real temp git repo (no git mocks). GitHub lookups go through
// the injected `runGh` (network boundary); WI-8 R1/R1b are the real-path check.

describe("check-source CLI", () => {
  let sb: GitSandbox;
  let repo: string;
  let outFile: string;
  let out: string[];
  let err: string[];

  const writeVersions = (pkg: string, conf: string, cargo: string) => {
    sb.write(repo, "package.json", JSON.stringify({ name: "mdpro", version: pkg }, null, 2));
    sb.write(repo, "src-tauri/tauri.conf.json", JSON.stringify({ productName: "mdpro", version: conf }, null, 2));
    sb.write(
      repo,
      "src-tauri/Cargo.toml",
      `[package]\nname = "mdpro"\nversion = "${cargo}"\n\n[dependencies]\nserde = { version = "1.0.0" }\n`,
    );
  };

  const env = () => ({ ...process.env, GITHUB_OUTPUT: outFile, GIT_CEILING_DIRECTORIES: sb.root });
  const run = (argv: string[], extra: Record<string, unknown> = {}): number =>
    checkSourceMain(argv, {
      cwd: repo,
      env: env(),
      out: (s: string) => out.push(s),
      err: (s: string) => err.push(s),
      ...extra,
    });

  beforeEach(() => {
    sb = new GitSandbox();
    sb.stubEnv();
    repo = sb.init("repo");
    outFile = path.join(sb.root, "github_output");
    fs.writeFileSync(outFile, "");
    out = [];
    err = [];
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    sb.cleanup();
  });

  it("S13 mismatched files → exit 1, every error printed, no sha= line in GITHUB_OUTPUT", () => {
    writeVersions("0.3.1", "0.3.1", "0.3.0");
    sb.commitAll(repo, "c1");
    const sha = sb.git(repo, ["rev-parse", "HEAD"]).trim();
    const code = run(["--mode", "build-only", "--ref", sha, "--version", "0.3.1", "--skip-github"]);
    expect(code).toBe(1);
    expect(fs.readFileSync(outFile, "utf8")).not.toMatch(/^sha=/m);
    expect(err.join("\n")).toContain(CARGO);
  });

  it("S2/S13 annotated tag ref: sha output is the peeled commit, not the tag object", () => {
    writeVersions("0.3.1", "0.3.1", "0.3.1");
    sb.commitAll(repo, "c1");
    sb.git(repo, ["tag", "-a", "v0.3.1", "-m", "release"]);
    const commit = sb.git(repo, ["rev-parse", "HEAD"]).trim();
    const tagObject = sb.git(repo, ["rev-parse", "v0.3.1"]).trim();
    expect(tagObject).not.toBe(commit);
    const code = run(["--mode", "build-only", "--ref", "v0.3.1", "--version", "0.3.1", "--skip-github"]);
    expect(code).toBe(0);
    const written = fs.readFileSync(outFile, "utf8");
    expect(written).toMatch(new RegExp(`^sha=${commit}$`, "m"));
    expect(written).toMatch(/^version=0\.3\.1$/m);
    expect(written).toMatch(/^tag=v0\.3\.1$/m);
    expect(written).not.toContain(tagObject);
  });

  it("draft mode reads GitHub facts: a published release on the tag → exit 1", () => {
    writeVersions("0.3.1", "0.3.1", "0.3.1");
    sb.commitAll(repo, "c1");
    const sha = sb.git(repo, ["rev-parse", "HEAD"]).trim();
    const runGh = (args: string[]) =>
      args.some((a) => a.endsWith("/releases/latest"))
        ? { status: 0, stdout: "v0.3.0\n", stderr: "" }
        : { status: 0, stdout: "false\n", stderr: "" };
    const code = run(["--mode", "draft", "--ref", sha, "--version", "0.3.1", "--repo", "anzchy/mdpro"], { runGh });
    expect(code).toBe(1);
    expect(fs.readFileSync(outFile, "utf8")).toBe("");
  });

  it("draft mode: no release on the tag, latest v0.3.0 → exit 0 and outputs written", () => {
    writeVersions("0.3.1", "0.3.1", "0.3.1");
    sb.commitAll(repo, "c1");
    const sha = sb.git(repo, ["rev-parse", "HEAD"]).trim();
    const runGh = (args: string[]) =>
      args.some((a) => a.endsWith("/releases/latest"))
        ? { status: 0, stdout: "v0.3.0\n", stderr: "" }
        : { status: 0, stdout: "", stderr: "" };
    const code = run(["--mode", "draft", "--ref", sha, "--version", "0.3.1", "--repo", "anzchy/mdpro"], { runGh });
    expect(code).toBe(0);
    expect(fs.readFileSync(outFile, "utf8")).toMatch(new RegExp(`^sha=${sha}$`, "m"));
  });

  it("a GitHub lookup failure other than 404 fails closed → exit 1", () => {
    writeVersions("0.3.1", "0.3.1", "0.3.1");
    sb.commitAll(repo, "c1");
    const sha = sb.git(repo, ["rev-parse", "HEAD"]).trim();
    const runGh = () => ({ status: 1, stdout: "", stderr: "HTTP 500: server error" });
    const code = run(["--mode", "draft", "--ref", sha, "--version", "0.3.1", "--repo", "anzchy/mdpro"], { runGh });
    expect(code).toBe(1);
    expect(fs.readFileSync(outFile, "utf8")).toBe("");
  });

  it("missing --ref / --version → exit 1 with usage", () => {
    expect(run(["--mode", "build-only"])).toBe(1);
    expect(err.join("\n")).toMatch(/--ref/);
  });

  it("the real script runs as a process (entry wiring)", () => {
    writeVersions("0.3.1", "0.3.1", "0.3.0");
    sb.commitAll(repo, "c1");
    const sha = sb.git(repo, ["rev-parse", "HEAD"]).trim();
    const script = path.resolve(__dirname, "../scripts/release/check-source.mjs");
    const r = spawnSync(
      process.execPath,
      [script, "--mode", "build-only", "--ref", sha, "--version", "0.3.1", "--skip-github"],
      { cwd: repo, env: env(), encoding: "utf8" },
    );
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(CARGO);
  });
});
