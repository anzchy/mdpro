// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { at, job, scalar, stepRun, steps } from "../support/workflowBlocks";

const runFile = promisify(execFile);
const script = path.resolve("scripts/release/devReleaseId.mjs");
const node = process.execPath;
const sha = "0123456789abcdef0123456789abcdef01234567";
const otherSha = "fedcba9876543210fedcba9876543210fedcba98";
const dirs: string[] = [];

async function command(file: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = process.env) {
  try {
    const { stdout, stderr } = await runFile(file, args, { cwd, env });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const e = error as Error & { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? e.message };
  }
}

async function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "d322-"));
  dirs.push(dir);
  fs.writeFileSync(path.join(dir, "package.json"), '{"version":"0.3.5"}\n');
  fs.mkdirSync(path.join(dir, "scripts", "release"), { recursive: true });
  fs.copyFileSync(script, path.join(dir, "scripts", "release", "devReleaseId.mjs"));
  await runFile("git", ["init", "-q", dir]);
  await runFile("git", ["-C", dir, "config", "user.name", "D322 Test"]);
  await runFile("git", ["-C", dir, "config", "user.email", "d322@example.invalid"]);
  await runFile("git", ["-C", dir, "add", "package.json"]);
  await runFile("git", ["-C", dir, "add", "scripts/release/devReleaseId.mjs"]);
  await runFile("git", ["-C", dir, "commit", "-qm", "fixture"]);
  const { stdout } = await runFile("git", ["rev-parse", "HEAD"], { cwd: dir });
  return { dir, head: stdout.trim() };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const workflow = fs.readFileSync(path.resolve(".github/workflows/build-windows.yml"), "utf8");
const winSteps = steps(job(workflow, "build-windows"));
const namedStep = (name: string) => winSteps.find((step) => scalar(step, "name") === name);
const stepIndex = (name: string) => winSteps.findIndex((step) => scalar(step, "name") === name);

async function bashStep(step: string, cwd: string, version: string, head: string, output: string) {
  const source = stepRun(step)!
    .replaceAll("${{ inputs.version }}", version)
    .replaceAll("${{ steps.version.outputs.VERSION }}", version);
  return command("bash", ["-e", "-o", "pipefail", "-c", source], cwd, {
    ...process.env, GITHUB_SHA: head, GITHUB_OUTPUT: output,
  });
}

describe("D322-WI-2 Windows build contract", () => {
  it("feeds the CLI output only to NSIS and names the artifact with version and SHA7", () => {
    const identity = namedStep("Resolve development release ID");
    const nsis = namedStep("Build NSIS installer");
    const sidecar = namedStep("Build mdpro_mcp sidecar (Windows x64)");
    const upload = namedStep("Upload NSIS installer");
    expect(identity).toBeDefined();
    expect(stepRun(identity!)).toContain("node scripts/release/devReleaseId.mjs");
    expect(stepRun(identity!)).toContain("--version");
    expect(stepRun(identity!)).toContain("GITHUB_OUTPUT");
    expect(stepRun(identity!)).not.toContain("--allow-dirty");
    expect(scalar(identity!, "id")).toBe("dev-release-id");
    expect(scalar(at(nsis!, ["env"]), "MDPRO_RELEASE_ID")).toBe("${{ steps.dev-release-id.outputs.RELEASE_ID }}");
    expect(at(sidecar!, ["env"])).toBeNull();
    expect(scalar(at(job(workflow, "build-windows"), ["env"]), "MDPRO_RELEASE_ID")).toBeNull();
    expect(scalar(at(upload!, ["with"]), "name")).toBe("mdpro-windows-${{ steps.version.outputs.VERSION }}-dev-${{ steps.dev-release-id.outputs.SHA7 }}");
  });

  it("resolves identity on a clean tree before both manifest patches and install", async () => {
    const sequence = ["Resolve version", "Resolve development release ID", "Patch version in tauri.conf.json", "Patch version in Cargo.toml", "Install JS dependencies", "Build NSIS installer"];
    for (let i = 1; i < sequence.length; i++) expect(stepIndex(sequence[i])).toBeGreaterThan(stepIndex(sequence[i - 1]));
    expect(stepIndex("Resolve version")).toBeGreaterThan(winSteps.findIndex((step) => scalar(step, "uses") === "actions/checkout@v4"));
    const { dir, head } = await repo();
    // GitHub's output file is outside the checkout in the real runner.
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "d322-output-"));
    dirs.push(outDir);
    const externalOutput = path.join(outDir, "github-output");
    fs.writeFileSync(externalOutput, "");
    expect((await bashStep(namedStep("Resolve version")!, dir, "", head, externalOutput)).code).toBe(0);
    expect(fs.readFileSync(externalOutput, "utf8")).toContain("VERSION=0.3.5");
    expect((await bashStep(namedStep("Resolve development release ID")!, dir, "0.3.5", head, externalOutput)).code).toBe(0);
    expect(fs.readFileSync(externalOutput, "utf8")).toContain(`RELEASE_ID=0.3.5-dev@${head}`);
    expect((await command("git", ["status", "--porcelain"], dir)).stdout).toBe("");
  });

  it("propagates CLI failure instead of publishing an empty ID", async () => {
    const { dir } = await repo();
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "d322-output-"));
    dirs.push(outDir);
    const output = path.join(outDir, "github-output");
    fs.writeFileSync(output, "");
    const result = await bashStep(namedStep("Resolve development release ID")!, dir, "0.3.5", otherSha, output);
    expect(result.code).not.toBe(0);
    expect(fs.readFileSync(output, "utf8")).not.toMatch(/^RELEASE_ID=/m);
    expect(scalar(namedStep("Resolve development release ID")!, "continue-on-error")).toBeNull();
  });

  it("patches both manifests to an explicit version that matches the generated ID", async () => {
    const { dir } = await repo();
    fs.mkdirSync(path.join(dir, "src-tauri"));
    fs.writeFileSync(path.join(dir, "src-tauri", "Cargo.toml"), '[package]\nname = "tauri-app"\nversion = "0.3.5"\n');
    fs.writeFileSync(path.join(dir, "src-tauri", "tauri.conf.json"), '{"version": "0.3.5"}\n');
    await runFile("git", ["add", "src-tauri"], { cwd: dir });
    await runFile("git", ["commit", "-qm", "add manifests"], { cwd: dir });
    const updatedHead = (await command("git", ["rev-parse", "HEAD"], dir)).stdout.trim();
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "d322-output-"));
    dirs.push(outDir);
    const output = path.join(outDir, "github-output");
    fs.writeFileSync(output, "");
    expect((await bashStep(namedStep("Resolve version")!, dir, "0.3.6", updatedHead, output)).code).toBe(0);
    expect(fs.readFileSync(output, "utf8")).toContain("VERSION=0.3.6");
    expect((await bashStep(namedStep("Resolve development release ID")!, dir, "0.3.6", updatedHead, output)).code).toBe(0);
    expect(fs.readFileSync(output, "utf8")).toContain(`RELEASE_ID=0.3.6-dev@${updatedHead}`);
    for (const name of ["Patch version in tauri.conf.json", "Patch version in Cargo.toml"]) {
      const source = stepRun(namedStep(name)!)!.replaceAll("${{ steps.version.outputs.VERSION }}", "0.3.6");
      const result = await command("pwsh", ["-NoProfile", "-Command", source], dir);
      expect(result.code).toBe(0);
    }
    expect(JSON.parse(fs.readFileSync(path.join(dir, "src-tauri", "tauri.conf.json"), "utf8")).version).toBe("0.3.6");
    expect(fs.readFileSync(path.join(dir, "src-tauri", "Cargo.toml"), "utf8")).toMatch(/^version = "0\.3\.6"$/m);
  });
});

describe("D322-WI-2 device instructions and comments", () => {
  const macSkill = path.resolve(".agents/skills/macos-device-test/SKILL.md");
  const windowsSkill = path.resolve(".agents/skills/remote-windows-device-test/SKILL.md");

  it("every macOS bundle build site obtains and checks the identity", () => {
    const source = fs.readFileSync(macSkill, "utf8");
    const builds = [...source.matchAll(/pnpm tauri build(?: --debug)? --bundles app/g)];
    expect(builds.length).toBeGreaterThanOrEqual(4);
    for (const build of builds) {
      const before = source.slice(Math.max(0, build.index! - 160), build.index);
      expect(before).toContain('release_id="$(node scripts/release/devReleaseId.mjs)"');
      expect(before).toContain('MDPRO_RELEASE_ID="$release_id"');
      expect(before).toContain("set -e");
    }
    expect(source).toMatch(/app\.ready\.releaseId/);
    expect(source).toMatch(/unknown.*wrong build/i);
  });

  it("a failed documented CLI stops before pnpm runs", async () => {
    const source = fs.readFileSync(macSkill, "utf8");
    const build = source.match(/\( set -e; release_id="\$\(node scripts\/release\/devReleaseId\.mjs\)"; MDPRO_RELEASE_ID="\$release_id" pnpm tauri build --bundles app \)/)?.[0];
    expect(build).toBeDefined();
    const bin = fs.mkdtempSync(path.join(os.tmpdir(), "d322-bin-"));
    dirs.push(bin);
    const marker = path.join(bin, "pnpm-ran");
    fs.writeFileSync(path.join(bin, "node"), "#!/bin/sh\nexit 17\n", { mode: 0o755 });
    fs.writeFileSync(path.join(bin, "pnpm"), `#!/bin/sh\ntouch '${marker}'\n`, { mode: 0o755 });
    const result = await command("bash", ["-c", build!], bin, { ...process.env, PATH: `${bin}:${process.env.PATH}` });
    expect(result.code).not.toBe(0);
    expect(fs.existsSync(marker)).toBe(false);
  });

  it("identifies Windows artifacts and rejects an unknown launch identity", () => {
    const source = fs.readFileSync(windowsSkill, "utf8");
    expect(source).toMatch(/mdpro-windows-.*-dev-.*sha7/i);
    expect(source).toMatch(/app\.ready.*releaseId/);
    expect(source).toMatch(/unknown.*wrong build/i);
  });

  it("leaves no release-only setter claim in the granted comments", () => {
    for (const file of ["src-tauri/src/main.rs", "src-tauri/src/services/release_info.rs", "src-tauri/src/services/app_ready.rs", "scripts/release/releaseId.mjs"]) {
      const source = fs.readFileSync(path.resolve(file), "utf8");
      expect(source, file).not.toMatch(/(?:only[^\n]*release\.yml|release\.yml[^\n]*only[^\n]*MDPRO_RELEASE_ID)/i);
    }
  });
});

// Mirrors release_info.rs: core has three non-leading-zero decimal parts;
// prerelease is nonempty ASCII alphanumeric/dot/hyphen; SHA is 40 lowercase hex.
function rustAccepts(id: string) {
  const parts = id.split("@");
  if (parts.length !== 2 || !/^[0-9a-f]{40}$/.test(parts[1])) return false;
  const [core, ...pre] = parts[0].split("-");
  if (!core.split(".").every((n) => /^(0|[1-9][0-9]*)$/.test(n)) || core.split(".").length !== 3) return false;
  return pre.length === 0 || /^[0-9A-Za-z.-]+$/.test(pre.join("-"));
}

// @ts-expect-error -- plain ESM script has no TypeScript declaration by design.
const scriptModule = await import("../../scripts/release/devReleaseId.mjs").catch(() => ({}));
const devReleaseId = (scriptModule as { devReleaseId?: (input: { version?: unknown; sha?: unknown; dirty?: boolean; allowDirty?: boolean }) => string }).devReleaseId;

describe("D322-WI-1 development release ID", () => {
  it("preserves valid core version and full SHA in the Rust grammar", () => {
    expect(typeof devReleaseId).toBe("function");
    const versions = ["0.0.0", "0.3.5", "10.20.30", "18446744073709551616.0.1"];
    const shas = [sha, otherSha, "a".repeat(40), "0".repeat(40)];
    for (const version of versions) for (const commit of shas) {
      const id = devReleaseId!({ version, sha: commit, dirty: false });
      expect(id).toBe(`${version}-dev@${commit}`);
      expect(rustAccepts(id)).toBe(true);
    }
  });

  it("refuses dirty by default and makes opt-in visibly dirty", () => {
    expect(() => devReleaseId!({ version: "0.3.5", sha, dirty: true })).toThrow();
    const id = devReleaseId!({ version: "0.3.5", sha, dirty: true, allowDirty: true });
    expect(id).toBe(`0.3.5-dev.dirty@${sha}`);
    expect(id).not.toBe(`0.3.5-dev@${sha}`);
    expect(rustAccepts(id)).toBe(true);
  });

  it.each([
    [undefined, sha], [null, sha], ["", sha], ["1.2", sha], ["01.2.3", sha],
    ["1.2.3+build", sha], ["1.2.3-rc.1", sha], ["١.2.3", sha],
    ["0.3.5", undefined], ["0.3.5", sha.slice(0, 39)], ["0.3.5", sha + "0"],
    ["0.3.5", sha.toUpperCase()], ["0.3.5", sha.slice(0, 39) + "g"],
  ])("rejects invalid version/SHA %# without fabricating an ID", (version, commit) => {
    expect(typeof devReleaseId).toBe("function");
    expect(() => devReleaseId!({ version, sha: commit })).toThrow();
  });

  it("mirrors the Rust acceptance and rejection examples", () => {
    for (const version of ["0.0.0", "10.20.30", "1.2.3-rc.1", "1.2.3-alpha-2.x", "0.3.1-0"]) {
      expect(rustAccepts(`${version}@${sha}`)).toBe(true);
    }
    for (const id of ["", `1.2.3+build@${sha}`, `01.2.3@${sha}`, `1.2.3-@${sha}`, `1.2.3-rc_1@${sha}`, `1.2.3@${sha.toUpperCase()}`, `1.2.3@${sha.slice(1)}`, `1.2.3@${sha} `, `1.2.3@${sha}@${sha}`]) {
      expect(rustAccepts(id)).toBe(false);
    }
  });

  it("reads a clean checkout exactly, then refuses a tracked edit unless opted in", async () => {
    const { dir, head } = await repo();
    for (let n = 0; n < 2; n++) expect(await command(node, [script], dir)).toEqual({ code: 0, stdout: `0.3.5-dev@${head}\n`, stderr: "" });
    fs.writeFileSync(path.join(dir, "package.json"), '{"version":"0.3.5","changed":true}\n');
    const refused = await command(node, [script], dir);
    expect(refused.code).not.toBe(0);
    expect(refused.stdout).toBe("");
    expect(refused.stderr).toMatch(/dirty/i);
    expect(await command(node, [script, "--allow-dirty"], dir)).toEqual({ code: 0, stdout: `0.3.5-dev.dirty@${head}\n`, stderr: "" });
  });

  it("checks GITHUB_SHA against HEAD", async () => {
    const { dir, head } = await repo();
    expect(await command(node, [script], dir, { ...process.env, GITHUB_SHA: head })).toEqual({ code: 0, stdout: `0.3.5-dev@${head}\n`, stderr: "" });
    for (const wrong of [otherSha, "bad"]) {
      const result = await command(node, [script], dir, { ...process.env, GITHUB_SHA: wrong });
      expect(result.code).not.toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toMatch(/GITHUB_SHA/i);
    }
  });

  it("validates --version with the same rule and leaves the checkout clean", async () => {
    const { dir, head } = await repo();
    expect(await command(node, [script, "--version", "0.3.6"], dir)).toEqual({ code: 0, stdout: `0.3.6-dev@${head}\n`, stderr: "" });
    for (const bad of ["1.2.3-rc.1", "1.2.3+build", "01.2.3"]) {
      const result = await command(node, [script, "--version", bad], dir);
      expect(result.code).not.toBe(0);
      expect(result.stdout).toBe("");
    }
    expect((await command("git", ["status", "--porcelain"], dir)).stdout).toBe("");
  });

  it("fails without a repository, package version, or known flag", async () => {
    const { dir } = await repo();
    const noRepo = fs.mkdtempSync(path.join(os.tmpdir(), "d322-norepo-"));
    dirs.push(noRepo);
    fs.writeFileSync(path.join(noRepo, "package.json"), '{"version":"0.3.5"}');
    for (const [cwd, args] of [[noRepo, []], [dir, ["--bogus"]]] as [string, string[]][]) {
      const result = await command(node, [script, ...args], cwd);
      expect(result.code).not.toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr.length).toBeGreaterThan(0);
    }
    fs.writeFileSync(path.join(dir, "package.json"), "{}");
    const missing = await command(node, [script], dir);
    expect(missing.code).not.toBe(0);
    expect(missing.stdout).toBe("");
  });

  it("detects staged-only and untracked dirt independently", async () => {
    for (const kind of ["staged", "untracked"]) {
      const { dir, head } = await repo();
      if (kind === "staged") {
        fs.writeFileSync(path.join(dir, "package.json"), '{"version":"0.3.5","x":1}\n');
        await runFile("git", ["add", "package.json"], { cwd: dir });
      } else fs.writeFileSync(path.join(dir, "new.txt"), "new");
      const denied = await command(node, [script], dir);
      expect(denied.code).not.toBe(0);
      expect(denied.stdout).toBe("");
      expect(await command(node, [script, "--allow-dirty"], dir)).toEqual({ code: 0, stdout: `0.3.5-dev.dirty@${head}\n`, stderr: "" });
    }
  });

  it("fails when Git itself is unavailable", async () => {
    const { dir } = await repo();
    const emptyPath = fs.mkdtempSync(path.join(os.tmpdir(), "d322-path-"));
    dirs.push(emptyPath);
    const result = await command(node, [script], dir, { ...process.env, PATH: emptyPath });
    expect(result.code).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/git/i);
  });
});
