// @vitest-environment node
/**
 * WI-15 (ADR-0047): `runBuild` when a tool exits 0 but leaves its artifact out.
 * Matrix: `.claude/tdd-guardian/tests-20261002-201520.md`, unit
 * `build.mjs#runBuild, missing artifacts after a successful tool`, WI-10/T23-T24.
 *
 * Real tmp git repos (`mkBuildRepo`) and the real filesystem; only the tool
 * spawner is faked (`makeFakeRun`, knobs `omitMainBinary` / `omitBuiltSidecar`).
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GitSandbox } from "./helpers/controlGitRepo";
import { appPath, makeFakeRun, manifestPath, mkBuildRepo, seedStale, type Profile } from "./helpers/controlBuildRepo";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { BuildError, runBuild } from "../scripts/control/build.mjs";

let sb: GitSandbox;

beforeEach(() => {
  sb = new GitSandbox();
  sb.stubEnv();
});

afterEach(() => {
  vi.unstubAllEnvs();
  sb.cleanup();
});

/** Run the build and return what it rejected with (`null` if it resolved). */
async function rejection(repo: string, argv: string[], run: ReturnType<typeof makeFakeRun>): Promise<unknown> {
  return runBuild({ repoRoot: repo, argv, run }).then(
    () => null,
    (e: unknown) => e,
  );
}

describe("WI-15 runBuild with a missing artifact after a successful tool", { timeout: 120_000 }, () => {
  it("WI-10/T23 tauri exits 0 but leaves no main binary", async () => {
    const repo = mkBuildRepo(sb, "r23");
    seedStale(repo, "release");
    const fake = makeFakeRun(repo, { omitMainBinary: true });

    const e = await rejection(repo, [], fake);
    expect(e).toBeInstanceOf(BuildError);
    expect(e instanceof Error ? e.name : "").toBe("BuildError");
    const message = e instanceof Error ? e.message : "";
    expect(message).toContain(
      "tauri build left no main binary at src-tauri/target/release/bundle/macos/mdpro.app/Contents/MacOS/tauri-app",
    );
    expect(message).not.toContain(repo);

    expect(fs.existsSync(manifestPath(repo, "release"))).toBe(false);
    expect(fs.existsSync(path.join(repo, "dist"))).toBe(true);
  });

  const T24_ROWS: { profile: Profile; name: string; argv: string[]; overlay: boolean; reason: string }[] = [
    {
      profile: "release",
      name: "r24r",
      argv: [],
      overlay: false,
      reason: "the sidecar build left no src-tauri/target/release/mdpro_mcp",
    },
    {
      profile: "verify",
      name: "r24v",
      argv: ["--profile", "verify"],
      overlay: true,
      reason: "the sidecar build left no src-tauri/target/verify/release/mdpro_mcp",
    },
  ];

  it.each(T24_ROWS)("WI-10/T24 cargo exits 0 but leaves no sidecar ($profile)", async (row) => {
    const repo = mkBuildRepo(sb, row.name, { verifyOverlay: row.overlay });
    seedStale(repo, row.profile);
    const fake = makeFakeRun(repo, { omitBuiltSidecar: true });

    const e = await rejection(repo, row.argv, fake);
    expect(e).toBeInstanceOf(BuildError);
    expect(e instanceof Error ? e.name : "").toBe("BuildError");
    const message = e instanceof Error ? e.message : "";
    expect(message).toContain(row.reason);
    expect(message).not.toContain(repo);

    expect(fs.existsSync(manifestPath(repo, row.profile))).toBe(false);
    expect(fs.existsSync(appPath(repo, row.profile))).toBe(false);
    // Supplementary (Level 6): tauri never ran, cargo ran once.
    expect(fake.calls.some((c) => c.cmd === "pnpm")).toBe(false);
    expect(fake.calls.filter((c) => c.cmd === "cargo").length).toBe(1);
  });
});
