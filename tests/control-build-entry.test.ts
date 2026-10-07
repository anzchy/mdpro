// @vitest-environment node
/**
 * WI-10 (ADR-0047): the build entry — `runBuild({ repoRoot, argv, run })` and
 * the CLI shim of `scripts/control/build.mjs`.
 * Matrix: `.claude/tdd-guardian/tests-20261002-155158.md`, unit WI-10, T01..T18;
 * plan decisions O1 (delete the manifest, then check the overlay), O2 (no `now`)
 * and O3 (`CARGO_TARGET_DIR` per profile).
 *
 * Every repo is a real tmp git repo (`mkBuildRepo`, real `sourceTree`, real fs).
 * Only `run`, the child-process spawner, is faked (`makeFakeRun`); it writes the
 * artifacts the real tools would, so assertions read files back. T15 runs the
 * real script as a child process, and T16 checks the real repo's ignore rules.
 *
 * Any path that may be absent is checked with `existsSync` before it is read.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GitSandbox } from "./helpers/controlGitRepo";
import {
  V2,
  appPath,
  binFile,
  builtSidecar,
  codesignText,
  mainBinary,
  makeFakeRun,
  manifestPath,
  mkBuildRepo,
  seedStale,
  sidecarBytes,
  type BuildRepoOptions,
  type FakeKnobs,
  type FakeRun,
  type Profile,
} from "./helpers/controlBuildRepo";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { BuildError, runBuild } from "../scripts/control/build.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { computeBuildId } from "../scripts/control/buildId.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { digestDir, parseCodesign, sha256File } from "../scripts/control/digests.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { DEFAULT_EXCLUDES, computeSourceTree } from "../scripts/control/sourceTree.mjs";

type Manifest = {
  buildId: string;
  sidecarSha256: string;
  distSha256: string;
  mainBinarySha256: string;
  codesign: unknown;
  commit: string | null;
  updaterArtifacts: boolean;
  bundle: string;
  features: string[];
};

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const F64 = "f".repeat(64);
const MTIME_2001 = 978307200000;
const REAL = {
  identifier: "tauri_app-f283913162faab95",
  format: "app bundle with Mach-O thin (arm64)",
  cdhash: "6140cd9271f655c037829fe53d1fc93b80de994e",
  signature: "adhoc",
  teamIdentifier: "not set",
};

let sb: GitSandbox;

beforeEach(() => {
  sb = new GitSandbox();
  sb.stubEnv();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  sb.cleanup();
});

const sha256 = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");

function build(repo: string, argv: string[], run: FakeRun): Promise<unknown> {
  return runBuild({ repoRoot: repo, argv, run });
}

/** Read a file that must exist; the existence check fails first, by assertion. */
function readExisting(p: string, label: string): Buffer {
  expect(fs.existsSync(p), `${label} exists`).toBe(true);
  return fs.readFileSync(p);
}

function readManifest(repo: string, profile: Profile): { text: string; M: Manifest } {
  const text = readExisting(manifestPath(repo, profile), `${profile} build-manifest.json`).toString("utf8");
  return { text, M: JSON.parse(text) as Manifest };
}

function callOf(fake: FakeRun, cmd: string) {
  return fake.calls.find((c) => c.cmd === cmd);
}

describe("WI-10 runBuild", { timeout: 120_000 }, () => {
  it("WI-10/T01 happy path (release, no features) writes a self-consistent manifest", async () => {
    const repo = mkBuildRepo(sb, "r");
    const fake = makeFakeRun(repo);
    await build(repo, [], fake);

    const { text, M } = readManifest(repo, "release");
    const tauri = callOf(fake, "pnpm");
    expect(tauri?.env.MDPRO_BUILD_ID).toBe(M.buildId);
    const binary = readExisting(mainBinary(repo, "release"), "main binary");
    expect(binary.includes(Buffer.from(M.buildId, "ascii"))).toBe(true);
    expect(M.sidecarSha256).toBe(sha256(readExisting(binFile(repo), "binaries/ sidecar")));
    const tree = (await computeSourceTree(repo)).tree;
    expect(M.buildId).toBe(
      computeBuildId({
        sourceTree: tree,
        sourceTreeExcludes: DEFAULT_EXCLUDES,
        profile: "release",
        features: [],
        sidecarSha256: M.sidecarSha256,
      }),
    );
    expect(M.distSha256).toBe(digestDir(path.join(repo, "dist")));
    expect(M.mainBinarySha256).toBe(sha256File(mainBinary(repo, "release")));
    expect(M.codesign).toEqual(parseCodesign(codesignText(appPath(repo, "release"))));
    expect(M.codesign).toEqual(REAL);
    expect(M.commit).toBe(sb.git(repo, ["rev-parse", "HEAD"]).trim());
    expect(M.updaterArtifacts).toBe(false);
    expect(M.bundle).toBe("src-tauri/target/release/bundle/macos/mdpro.app");
    expect(text).not.toContain(repo);
    expect(text).not.toContain(os.homedir());
    expect(text).not.toContain('"/');

    // Supplementary (Level 6): the boundary contract with the tools.
    expect(fake.calls.map((c) => c.cmd)).toEqual(["cargo", "pnpm", "codesign"]);
    const args = tauri?.args ?? [];
    expect(args).toContain("--bundles");
    expect(args[args.indexOf("--bundles") + 1]).toBe("app");
    expect(JSON.parse(args[args.indexOf("--config") + 1] ?? "null")).toEqual({
      bundle: { createUpdaterArtifacts: false },
    });
  });

  it("WI-10/T02 features flow to both cargo steps and the manifest", async () => {
    const repo = mkBuildRepo(sb, "r");
    await build(repo, [], makeFakeRun(repo));
    const first = readManifest(repo, "release").M;

    await build(repo, ["--features", "b,a"], makeFakeRun(repo));
    const { M } = readManifest(repo, "release");
    expect(readExisting(binFile(repo), "binaries/ sidecar").toString("utf8").endsWith("features=a,b")).toBe(true);
    expect(readExisting(path.join(repo, "dist", "index.html"), "dist/index.html").toString("utf8")).toContain("a,b");
    expect(M.features).toEqual(["a", "b"]);
    expect(M.buildId).not.toBe(first.buildId);
  });

  it("WI-10/T03 deterministic manifest on an unchanged repo, across wall-clock time", async () => {
    const repo = mkBuildRepo(sb, "r");
    let text1: string;
    let text2: string;
    try {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
      await build(repo, [], makeFakeRun(repo));
      text1 = readManifest(repo, "release").text;
      vi.setSystemTime(new Date("2031-06-15T12:34:56Z"));
      await build(repo, [], makeFakeRun(repo));
      text2 = readManifest(repo, "release").text;
    } finally {
      vi.useRealTimers();
    }
    expect(text2).toBe(text1);
    for (const needle of [
      "2026-01-01",
      "2031-06-15",
      "12:34:56",
      String(Date.UTC(2026, 0, 1)),
      String(Date.UTC(2031, 5, 15, 12, 34, 56)),
    ]) {
      expect(text1).not.toContain(needle);
    }
  });

  it("WI-10/T04 embedded id equals manifest id across configurations, and the ids are distinct", async () => {
    const repo = mkBuildRepo(sb, "r", { verifyOverlay: true });
    const runOnce = async (argv: string[], profile: Profile) => {
      await build(repo, argv, makeFakeRun(repo));
      const out = readManifest(repo, profile);
      const binary = readExisting(mainBinary(repo, profile), `${profile} main binary`);
      expect(binary.includes(Buffer.from(out.M.buildId, "ascii"))).toBe(true);
      return out;
    };
    const i = await runOnce([], "release");
    const ii = await runOnce(["--features", "x"], "release");
    const iii = await runOnce(["--profile", "verify"], "verify");
    expect(readManifest(repo, "release").text).toBe(ii.text);
    sb.write(repo, "src/a.ts", "A1\n");
    const iv = await runOnce([], "release");
    sb.write(repo, "src/a.ts", "A0\n");
    const v = await runOnce([], "release");

    expect(new Set([i.M.buildId, ii.M.buildId, iii.M.buildId, iv.M.buildId]).size).toBe(4);
    expect(v.text).toBe(i.text);
  });

  it("WI-10/T05 verify uses target/verify and its own sidecar, release does not", async () => {
    const repo = mkBuildRepo(sb, "r", { verifyOverlay: true });
    fs.mkdirSync(path.dirname(builtSidecar(repo, "release")), { recursive: true });
    fs.writeFileSync(builtSidecar(repo, "release"), "stale-release-sidecar");

    const verifyFake = makeFakeRun(repo);
    await build(repo, ["--profile", "verify"], verifyFake);
    const verify = readManifest(repo, "verify").M;
    expect(verify.bundle.startsWith("src-tauri/target/verify/")).toBe(true);
    const verifyBytes = readExisting(builtSidecar(repo, "verify"), "verify sidecar build output");
    const copied = readExisting(binFile(repo), "binaries/ sidecar");
    expect(copied.equals(verifyBytes)).toBe(true);
    expect(copied.toString("utf8")).toContain("tgt=verify");
    expect(copied.toString("utf8")).not.toBe("stale-release-sidecar");
    expect(verify.sidecarSha256).toBe(sha256(verifyBytes));

    const releaseFake = makeFakeRun(repo);
    await build(repo, [], releaseFake);
    expect(readManifest(repo, "release").M.bundle.startsWith("src-tauri/target/release/")).toBe(true);
    expect(readExisting(binFile(repo), "binaries/ sidecar").toString("utf8")).toContain("tgt=target");

    // Supplementary (Level 6): the environment each cargo step saw.
    const verifyDir = path.join("src-tauri", "target", "verify");
    for (const cmd of ["cargo", "pnpm"]) {
      expect(callOf(verifyFake, cmd)?.env.CARGO_TARGET_DIR?.endsWith(verifyDir)).toBe(true);
      expect(callOf(releaseFake, cmd)?.env).toBeDefined();
      expect(callOf(releaseFake, cmd)?.env.CARGO_TARGET_DIR).toBeUndefined();
    }
  });

  const USER = os.userInfo().username;
  type FailRow = {
    name: string;
    profile: Profile;
    knobs?: FakeKnobs;
    repo?: BuildRepoOptions;
    message: string | RegExp;
  };
  // WI-15: every row asserts the class, the name and a reason (a bare rejects.toThrow() also passed on a TypeError).
  const T06_ROWS: FailRow[] = [
    { name: "failCargo", profile: "release", knobs: { failCargo: true }, message: /sidecar|mdpro_mcp/ },
    { name: "failTauri", profile: "release", knobs: { failTauri: true }, message: "tauri build failed" },
    {
      name: "editTrackedDuringTauri",
      profile: "release",
      knobs: { editTrackedDuringTauri: true },
      message: "source tree changed during build",
    },
    { name: "omitId", profile: "release", knobs: { omitId: true }, message: "binary does not embed buildId" },
    { name: "staleId", profile: "release", knobs: { staleId: true }, message: "binary does not embed buildId" },
    { name: "failCodesign", profile: "release", knobs: { failCodesign: true }, message: "codesign -dvvv failed" },
    { name: "codesignNoCdhash", profile: "release", knobs: { codesignNoCdhash: true }, message: "CDHash" },
    {
      name: "a codesign identifier carrying the user name",
      profile: "release",
      knobs: { codesignIdentifier: `com.${USER}.app` },
      message: "identifier",
    },
    {
      name: "a @tauri-apps/cli version carrying the user name",
      profile: "release",
      repo: { cliVersion: `2.0.0-${USER}` },
      message: "versions",
    },
    { name: "verify without the overlay", profile: "verify", message: "tauri.verify.conf.json" },
  ];

  it.each(T06_ROWS)("WI-10/T06 $name leaves no manifest, including no stale one", async (row) => {
    const repo = mkBuildRepo(sb, "r", row.repo);
    seedStale(repo, row.profile);
    const argv = row.profile === "verify" ? ["--profile", "verify"] : [];
    const e: unknown = await build(repo, argv, makeFakeRun(repo, row.knobs)).then(
      () => null,
      (x: unknown) => x,
    );
    expect(e).toBeInstanceOf(BuildError);
    expect(e instanceof Error ? e.name : "").toBe("BuildError");
    const message = e instanceof Error ? e.message : "";
    if (typeof row.message === "string") expect(message).toContain(row.message);
    else expect(message).toMatch(row.message);
    expect(fs.existsSync(manifestPath(repo, row.profile))).toBe(false);
  });

  it("WI-10/T07 sidecar failure stops before tauri", async () => {
    const repo = mkBuildRepo(sb, "r");
    const fake = makeFakeRun(repo, { failCargo: true });
    await expect(build(repo, [], fake)).rejects.toThrow(/sidecar|mdpro_mcp/);
    expect(fs.existsSync(appPath(repo, "release"))).toBe(false);
    expect(fs.existsSync(appPath(repo, "verify"))).toBe(false);
    expect(fake.calls.some((c) => c.cmd === "pnpm")).toBe(false);
  });

  it("WI-10/T08 source tree changed during build", async () => {
    const repo = mkBuildRepo(sb, "r");
    const fake = makeFakeRun(repo, { editTrackedDuringTauri: true });
    await expect(build(repo, [], fake)).rejects.toThrow("source tree changed during build");
    expect(fs.existsSync(manifestPath(repo, "release"))).toBe(false);
  });

  const T09_ROWS: [string, FakeKnobs][] = [
    ["omitId", { omitId: true }],
    ["staleId", { staleId: true }],
  ];
  it.each(T09_ROWS)("WI-10/T09 a binary with %s fails the embed check", async (_name, knobs) => {
    const repo = mkBuildRepo(sb, "r");
    const fake = makeFakeRun(repo, knobs);
    await expect(build(repo, [], fake)).rejects.toThrow("binary does not embed buildId");
    expect(fs.existsSync(manifestPath(repo, "release"))).toBe(false);
    const envId = callOf(fake, "pnpm")?.env.MDPRO_BUILD_ID;
    expect(envId).toMatch(/^[0-9a-f]{64}$/);
    expect(envId).not.toBe(V2);
  });

  it("WI-10/T10 verify without the overlay fails before any child process", async () => {
    const repo = mkBuildRepo(sb, "r");
    seedStale(repo, "verify");
    const fake = makeFakeRun(repo);
    const error: unknown = await build(repo, ["--profile", "verify"], fake).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(Error);
    const message = error instanceof Error ? error.message : "";
    expect(message).toContain("tauri.verify.conf.json");
    expect(message).toContain("WI-002");
    expect(fs.existsSync(manifestPath(repo, "verify"))).toBe(false);
    expect(fs.existsSync(binFile(repo))).toBe(false);
    expect(fake.calls.length).toBe(0);
  });

  it("WI-10/T11 identical sidecar bytes keep the binaries/ mtime", async () => {
    const repo = mkBuildRepo(sb, "r");
    const bytes = sidecarBytes("target", undefined, undefined);
    fs.writeFileSync(binFile(repo), bytes);
    fs.utimesSync(binFile(repo), new Date(MTIME_2001), new Date(MTIME_2001));

    await build(repo, [], makeFakeRun(repo));
    const { M } = readManifest(repo, "release");
    expect(fs.statSync(binFile(repo)).mtimeMs).toBe(MTIME_2001);
    expect(M.sidecarSha256).toBe(sha256(bytes));
  });

  it("WI-10/T12 differing sidecar bytes are replaced", async () => {
    const repo = mkBuildRepo(sb, "r");
    fs.writeFileSync(binFile(repo), "old");

    await build(repo, [], makeFakeRun(repo));
    const { M } = readManifest(repo, "release");
    const now = readExisting(binFile(repo), "binaries/ sidecar");
    expect(now.equals(readExisting(builtSidecar(repo, "release"), "sidecar build output"))).toBe(true);
    expect(now.toString("utf8")).toBe(sidecarBytes("target", undefined, undefined));
    expect(M.sidecarSha256).toBe(sha256(now));
    expect(M.sidecarSha256).not.toBe(sha256("old"));
  });

  it("WI-10/T13 a missing sidecar is placeholder-touched before the sidecar build", async () => {
    const repo = mkBuildRepo(sb, "r");
    expect(fs.existsSync(binFile(repo))).toBe(false);
    const fake = makeFakeRun(repo);

    await build(repo, [], fake);
    expect(callOf(fake, "cargo")?.binariesExisted).toBe(true);
    readManifest(repo, "release");
    expect(readExisting(binFile(repo), "binaries/ sidecar").toString("utf8")).toBe(
      sidecarBytes("target", undefined, undefined),
    );
  });

  it("WI-10/T14 MDPRO_BUILD_ID never reaches the sidecar build", async () => {
    vi.stubEnv("MDPRO_BUILD_ID", F64);
    const repo = mkBuildRepo(sb, "r");

    await build(repo, [], makeFakeRun(repo));
    const { M } = readManifest(repo, "release");
    expect(readExisting(binFile(repo), "binaries/ sidecar").toString("utf8")).toContain("build=<unset>");
    const binary = readExisting(mainBinary(repo, "release"), "main binary");
    expect(binary.includes(Buffer.from(M.buildId, "ascii"))).toBe(true);
    expect(binary.includes(Buffer.from(F64, "ascii"))).toBe(false);
    expect(M.buildId).not.toBe(F64);
  });

  it("WI-10/T15 the real CLI shim: --help and a bad flag", () => {
    const real = (["release", "verify"] as const).map((p) => manifestPath(REPO_ROOT, p));
    const snapshot = () => real.map((p) => (fs.existsSync(p) ? fs.readFileSync(p).toString("base64") : null));
    const before = snapshot();
    const script = path.join("scripts", "control", "build.mjs");

    const help = spawnSync(process.execPath, [script, "--help"], { cwd: REPO_ROOT, encoding: "utf8" });
    expect(help.status).toBe(0);
    expect(help.stdout).toContain("Usage");
    expect(help.stdout).toContain("--profile");

    const bogus = spawnSync(process.execPath, [script, "--bogus"], { cwd: REPO_ROOT, encoding: "utf8" });
    expect(bogus.status).toBe(1);
    expect(bogus.stderr).toContain("--bogus");
    const firstLine = bogus.stderr.trim().split("\n")[0] ?? "";
    expect(firstLine).toContain("--bogus");
    expect(firstLine).not.toContain(REPO_ROOT);

    expect(snapshot()).toEqual(before);
  });

  it("WI-10/T16 the real repo ignores every path a build writes", () => {
    const paths = [
      "dist/index.html",
      "src-tauri/target/release/x",
      "src-tauri/target/verify/release/x",
      "src-tauri/binaries/mdpro_mcp-aarch64-apple-darwin",
      "src-tauri/gen/schemas/x.json",
    ];
    const statuses = Object.fromEntries(
      paths.map((p) => [p, spawnSync("git", ["-C", REPO_ROOT, "check-ignore", "-q", p]).status]),
    );
    expect(statuses).toEqual(Object.fromEntries(paths.map((p) => [p, 0])));
  });

  it("WI-10/T17 commit is null in a repo with no commits", async () => {
    const repo = mkBuildRepo(sb, "r", { commit: false });
    await build(repo, [], makeFakeRun(repo));
    expect(readManifest(repo, "release").M.commit).toBeNull();
  });

  it("WI-10/T18 a caller's CARGO_TARGET_DIR is ignored for release", async () => {
    const otherTmp = fs.mkdtempSync(path.join(sb.root, "other-target-"));
    vi.stubEnv("CARGO_TARGET_DIR", otherTmp);
    const repo = mkBuildRepo(sb, "r");
    const fake = makeFakeRun(repo);

    await build(repo, [], fake);
    readManifest(repo, "release");
    expect(fs.readdirSync(otherTmp)).toEqual([]);
    expect(readExisting(binFile(repo), "binaries/ sidecar").toString("utf8")).toContain("tgt=target");
    for (const cmd of ["cargo", "pnpm"]) {
      const env = callOf(fake, cmd)?.env;
      expect(env).toBeDefined();
      expect(env && "CARGO_TARGET_DIR" in env).toBe(false);
    }
  });
});
