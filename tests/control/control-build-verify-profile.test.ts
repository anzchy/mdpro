// @vitest-environment node
/**
 * ADR-0047 WI-002 / WI-2: the build entry under `--profile verify` — the second
 * `--config` (the verify overlay), the `verify-run` feature the profile owns,
 * the `mdpro-verify.app` bundle name, and the rejection of a user-supplied
 * `verify-run` before anything is touched.
 * Matrix: `.claude/tdd-guardian/tests-20261003-061500.md` (r1), WI2-T01..T10
 * (T09 is the existing WI-10/T10 in `control-build-entry.test.ts`, unedited).
 *
 * Real tmp git repos (`mkBuildRepo`) and the real filesystem; only the tool
 * spawner is faked (`makeFakeRun`). The fake names the bundle from the merged
 * config it is handed, independently of `buildLayout`'s constant, so drift
 * between them is observable (T08).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GitSandbox } from "../helpers/controlGitRepo";
import {
  VERIFY_OVERLAY_ARG,
  appPath,
  binFile,
  makeFakeRun,
  manifestPath,
  mkBuildRepo,
  seedStale,
  type FakeRun,
  type Profile,
} from "../helpers/controlBuildRepo";
import { mergePatch, type Json } from "../helpers/jsonMergePatch";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { BuildArgsError, USAGE, parseBuildArgs } from "../../scripts/control/args.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { BuildError, runBuild } from "../../scripts/control/build.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { computeBuildId } from "../../scripts/control/buildId.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { NO_UPDATER_CONFIG, buildLayout, sidecarCommand, tauriCommand } from "../../scripts/control/buildSteps.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { DEFAULT_EXCLUDES, computeSourceTree } from "../../scripts/control/sourceTree.mjs";
import { collectionCases } from "../support/collectionCases";

type Manifest = { buildId: string; bundle: string; features: string[]; sidecarSha256: string };

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const VERIFY_RUN = "verify-run";
const SEED = 20261003;
/** Names sorting before and after `verify-run` in code-unit order, plus near misses. */
const POOL = ["a", "b", "Z", "_x", "w", "zz", "verify-runx", "xverify-run", "verify_run", "Verify-run", "v", "vz"];

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
type Rng = () => number;
const int = (r: Rng, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
const pick = <T>(r: Rng, xs: readonly T[]): T => xs[int(r, 0, xs.length - 1)];
const list = (r: Rng, pool: readonly string[]) => Array.from({ length: int(r, 0, 5) }, () => pick(r, pool));
const canon = (xs: string[]) => [...new Set(xs)].sort();
const featuresOf = (args: string[]) => (args.includes("--features") ? args[args.indexOf("--features") + 1] : undefined);

let sb: GitSandbox;

beforeEach(() => {
  sb = new GitSandbox();
  sb.stubEnv();
});

afterEach(() => {
  vi.unstubAllEnvs();
  sb.cleanup();
});

/** Run the build; `null` when it resolved, otherwise what it rejected with. */
function settle(repo: string, argv: string[], run: FakeRun): Promise<unknown> {
  return runBuild({ repoRoot: repo, argv, run }).then(
    () => null,
    (e: unknown) => e,
  );
}
const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

function readManifest(repo: string, profile: Profile): Manifest {
  const p = manifestPath(repo, profile);
  expect(fs.existsSync(p), `${profile} build-manifest.json exists`).toBe(true);
  return JSON.parse(fs.readFileSync(p, "utf8")) as Manifest;
}

const readJson = (rel: string) => JSON.parse(fs.readFileSync(path.join(REPO_ROOT, rel), "utf8")) as Json;
const nameOf = (config: Json) => (config as { productName?: unknown }).productName;

describe("WI-2 runBuild under the verify profile", { timeout: 120_000 }, () => {
  it("WI2-T01 verify build: exact tauri argv, manifest bundle and user features", async () => {
    const repo = mkBuildRepo(sb, "t01", { verifyOverlay: true });
    const fake = makeFakeRun(repo);
    expect(messageOf(await settle(repo, ["--profile", "verify", "--features", "b,a"], fake))).toBe("null");
    expect(fake.calls.find((c) => c.cmd === "pnpm")?.args).toEqual([
      "tauri",
      "build",
      "--bundles",
      "app",
      "--config",
      NO_UPDATER_CONFIG,
      "--config",
      "src-tauri/tauri.verify.conf.json",
      "--features",
      "a,b,verify-run",
    ]);
    const M = readManifest(repo, "verify");
    expect(M.features).toEqual(["a", "b"]);
    expect(M.bundle).toBe("src-tauri/target/verify/release/bundle/macos/mdpro-verify.app");
  });

  it("WI2-T02 release argv is unchanged: no overlay, no verify-run", async () => {
    const repo = mkBuildRepo(sb, "t02", { verifyOverlay: true });
    const fake = makeFakeRun(repo);
    expect(messageOf(await settle(repo, ["--features", "b,a"], fake))).toBe("null");
    expect(fake.calls.find((c) => c.cmd === "pnpm")?.args).toEqual([
      "tauri",
      "build",
      "--bundles",
      "app",
      "--config",
      NO_UPDATER_CONFIG,
      "--features",
      "a,b",
    ]);
    expect(readManifest(repo, "release").bundle.endsWith("target/release/bundle/macos/mdpro.app")).toBe(true);
  });

  it.each(["release", "verify"] as Profile[])(
    "WI2-T05 a user verify-run under %s is rejected before anything is touched",
    async (profile) => {
      const repo = mkBuildRepo(sb, `t05-${profile}`, { verifyOverlay: true });
      seedStale(repo, profile);
      const stale = fs.readFileSync(manifestPath(repo, profile));
      const fake = makeFakeRun(repo);
      const e = await settle(repo, ["--profile", profile, "--features=a,verify-run"], fake);
      expect(e).toBeInstanceOf(BuildArgsError);
      expect(fake.calls.length).toBe(0);
      expect(fs.existsSync(binFile(repo))).toBe(false);
      expect(fs.readFileSync(manifestPath(repo, profile)).equals(stale)).toBe(true);
      if (profile === "release") expect(fs.existsSync(manifestPath(repo, "verify"))).toBe(false);
    },
  );

  it("WI2-T08 an overlay productName drifting from the layout constant fails loudly", async () => {
    const repo = mkBuildRepo(sb, "t08", { verifyOverlay: true });
    const overlay = path.join(repo, VERIFY_OVERLAY_ARG);
    const drifted = { ...(JSON.parse(fs.readFileSync(overlay, "utf8")) as object), productName: "other" };
    fs.writeFileSync(overlay, `${JSON.stringify(drifted, null, 2)}\n`);
    const e = await settle(repo, ["--profile", "verify"], makeFakeRun(repo));
    expect(e).toBeInstanceOf(BuildError);
    expect(messageOf(e)).toContain("tauri build left no main binary");
    expect(fs.existsSync(manifestPath(repo, "verify"))).toBe(false);
    expect(path.basename(appPath(repo, "verify"))).toBe("other.app");
    expect(fs.existsSync(appPath(repo, "verify"))).toBe(true);
  });

  it("WI2-T10 buildId hashes the profile and the user features, not verify-run", async () => {
    const repo = mkBuildRepo(sb, "t10", { verifyOverlay: true });
    expect(messageOf(await settle(repo, ["--profile", "verify", "--features", "b,a"], makeFakeRun(repo)))).toBe("null");
    const verify = readManifest(repo, "verify");
    const tree = (await computeSourceTree(repo)).tree;
    expect(verify.buildId).toBe(
      computeBuildId({
        sourceTree: tree,
        sourceTreeExcludes: DEFAULT_EXCLUDES,
        profile: "verify",
        features: ["a", "b"],
        sidecarSha256: verify.sidecarSha256,
      }),
    );
    expect(messageOf(await settle(repo, ["--features", "b,a"], makeFakeRun(repo)))).toBe("null");
    expect(readManifest(repo, "release").buildId).not.toBe(verify.buildId);
  });
});

describe("WI-2 commands, arguments and layout", () => {
  it("WI2-T03 effective features per profile; the sidecar never gets verify-run", () => {
    expect(() => tauriCommand("verify", [])).not.toThrow();
    const r = mulberry32(SEED);
    for (let n = 0; n < 500; n++) {
      const user = list(r, POOL);
      const label = `seed ${SEED}, case ${n}, user ${JSON.stringify(user)}`;
      const [vCmd, vArgs] = tauriCommand("verify", user) as [string, string[]];
      expect(vCmd, label).toBe("pnpm");
      expect(featuresOf(vArgs), label).toBe(canon([...user, VERIFY_RUN]).join(","));
      const [, rArgs] = tauriCommand("release", user) as [string, string[]];
      expect(featuresOf(rArgs), label).toBe(user.length > 0 ? canon(user).join(",") : undefined);
      const [, sArgs] = sidecarCommand(user) as [string, string[]];
      expect((featuresOf(sArgs) ?? "").split(","), label).not.toContain(VERIFY_RUN);
    }
  });

  const T04_ARGV = [
    ["--features", "verify-run"],
    ["--features=verify-run"],
    ["--features", "a,verify-run"],
    ["--features", "a", "--features", "verify-run"],
  ];
  const T04_PROFILES = [["--profile", "release"], ["--profile", "verify"], []];
  it.each(collectionCases("tests/control/control-build-verify-profile.test.ts:209", T04_ARGV.flatMap((argv) => T04_PROFILES.map((p) => ({ argv: [...argv, ...p] })))))(
    "WI2-T04 parseBuildArgs rejects a user verify-run: $argv",
    ({ argv }) => {
      let e: unknown = null;
      try {
        parseBuildArgs(argv);
      } catch (x) {
        e = x;
      }
      expect(e).toBeInstanceOf(BuildArgsError);
      const message = messageOf(e);
      expect(message).toContain(VERIFY_RUN);
      expect(message).toContain("profile");
      expect(message).toMatch(/\bown/);
      expect(message.endsWith(USAGE)).toBe(true);
    },
  );

  it("WI2-T06 near-miss names are not rejected (rejection iff the exact token)", () => {
    const pool = POOL.filter((x) => x !== VERIFY_RUN);
    const r = mulberry32(SEED + 1);
    for (let n = 0; n < 200; n++) {
      const user = list(r, pool);
      const argv: string[] = [];
      for (const name of user) argv.push(...(r() < 0.5 ? ["--features", name] : [`--features=${name}`]));
      const profile = pick(r, ["release", "verify", undefined]);
      if (profile) argv.push("--profile", profile);
      const label = `seed ${SEED + 1}, case ${n}, argv ${JSON.stringify(argv)}`;
      const parsed = parseBuildArgs(argv) as { profile: string; features: string[] };
      expect(parsed, label).toEqual({ profile: profile ?? "release", features: canon(user) });
      expect(parsed.features, label).not.toContain(VERIFY_RUN);
    }
  });

  it("WI2-T07 the layout's verify bundle name equals the overlay's productName", () => {
    const base = readJson("src-tauri/tauri.conf.json");
    const merged = mergePatch(base, readJson("src-tauri/tauri.verify.conf.json"));
    const verifyApp = (buildLayout(REPO_ROOT, "verify") as { app: string }).app;
    const releaseApp = (buildLayout(REPO_ROOT, "release") as { app: string }).app;
    expect(path.basename(verifyApp)).toBe(`${String(nameOf(merged))}.app`);
    expect(path.basename(verifyApp)).toBe("mdpro-verify.app");
    expect(path.basename(releaseApp)).toBe(`${String(nameOf(base))}.app`);
    expect(verifyApp.split(path.sep).join("/").endsWith("target/verify/release/bundle/macos/mdpro-verify.app")).toBe(
      true,
    );
  });
});
