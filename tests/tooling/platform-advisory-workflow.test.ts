// @vitest-environment node
/**
 * MIG-003b (#754): the native platform advisory workflow, platform-advisory.yml.
 *
 * It compiles, lints and tests the Rust backend on macOS and Windows, nightly and on dispatch, never on a pull request.
 * It lands on these static pins; its first runs are the delegator's bootstrap after landing (spec r3 § Bootstrap).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { entry, items, keys, scalar, topLevel } from "../support/workflowBlocks";

const FILE = path.resolve(__dirname, "..", "..", ".github", "workflows", "platform-advisory.yml");
const TEXT = fs.existsSync(FILE) ? fs.readFileSync(FILE, "utf8") : "";

describe("MIG-003b platform-advisory.yml", () => {
  it("runs on the 03:37 cron and by dispatch with no inputs, never on a pull request or a push", () => {
    const on = topLevel(TEXT, "on");
    expect(keys(on)).toEqual(["schedule", "workflow_dispatch"]);
    expect(items(entry(on, "schedule")?.body ?? null).map((item) => scalar(item, "cron"))).toEqual(["37 3 * * *"]);
    expect(entry(on, "workflow_dispatch")).toEqual({ inline: null, body: "" });
  });
});

describe("MIG-003b platform-advisory.yml permissions", () => {
  it("only reads the repository", () => {
    const permissions = topLevel(TEXT, "permissions");
    expect(keys(permissions)).toEqual(["contents"]);
    expect(scalar(permissions, "contents")).toBe("read");
  });
});

describe("MIG-003b platform-advisory.yml concurrency", () => {
  it("queues runs per ref and never cancels one in progress", () => {
    const concurrency = topLevel(TEXT, "concurrency");
    expect(keys(concurrency)).toEqual(["group", "cancel-in-progress"]);
    expect(scalar(concurrency, "group")).toBe("platform-advisory-${{ github.ref }}");
    expect(scalar(concurrency, "cancel-in-progress")).toBe("false");
  });
});

import { at, job, jobIds, list } from "../support/workflowBlocks";

/** The matrix pin: one job, both OSes, no leg dropped, added or softened. Throws on a mismatch. */
function assertNativeMatrix(text: string): void {
  expect(jobIds(text)).toEqual(["native"]);
  const native = job(text, "native");
  const strategy = topLevel(native, "strategy");
  expect(keys(strategy).sort()).toEqual(["fail-fast", "matrix"]);
  expect(scalar(strategy, "fail-fast")).toBe("false");
  expect(keys(at(strategy, ["matrix"]))).toEqual(["os"]);
  expect(list(at(strategy, ["matrix"]), "os")).toEqual(["macos-latest", "windows-latest"]);
  expect(scalar(native, "runs-on")).toBe("${{ matrix.os }}");
  expect(scalar(native, "timeout-minutes")).toBe("60");
}

describe("MIG-003b platform-advisory.yml matrix", () => {
  it("runs one native job on macos-latest and windows-latest, not failing fast, within 60 minutes", () => {
    assertNativeMatrix(TEXT);
  });

  it("rejects a matrix that excludes a leg", () => {
    const mutant = TEXT.replace("os: [macos-latest, windows-latest]", "os: [macos-latest, windows-latest]\n        exclude:\n          - os: windows-latest");
    expect(mutant).not.toBe(TEXT);
    expect(() => assertNativeMatrix(mutant)).toThrow();
  });
});

import { steps } from "../support/workflowBlocks";

const nativeSteps = (text: string) => steps(job(text, "native"));
const usesIndex = (all: string[], prefix: string) => all.findIndex((s) => (scalar(s, "uses") ?? "").startsWith(prefix));

describe("MIG-003b platform-advisory.yml toolchain", () => {
  it("checks out first, then installs the stable toolchain with the clippy component", () => {
    const all = nativeSteps(TEXT);
    expect(usesIndex(all, "actions/checkout@")).toBe(0);
    const toolchain = all[usesIndex(all, "dtolnay/rust-toolchain@")];
    expect(scalar(toolchain, "uses")).toBe("dtolnay/rust-toolchain@stable");
    expect(list(topLevel(toolchain, "with"), "components")).toContain("clippy");
  });
});

const stepWithId = (all: string[], id: string) => all.find((s) => scalar(s, "id") === id) ?? null;

/**
 * A strict evaluator for a `${{ a == 'x' && b == 'y' }}` condition over a flat context. It accepts only `&&`-joined
 * equalities of a context name with a single-quoted string, and throws on anything else, so a widened condition
 * (`||`, `!=`, a function call) fails the pin instead of being misread.
 */
function evaluateConjunction(raw: string | null, context: Record<string, string>): boolean {
  const match = /^\$\{\{\s*(.*?)\s*\}\}$/.exec(raw ?? "");
  if (!match) throw new Error(`not an expression: ${String(raw)}`);
  return match[1].split(/\s*&&\s*/).every((term) => {
    const eq = /^([a-z_.]+)\s*==\s*'([^']*)'$/.exec(term);
    if (!eq || !(eq[1] in context)) throw new Error(`unsupported term: ${term}`);
    return context[eq[1]] === eq[2];
  });
}

describe("MIG-003b platform-advisory.yml cache", () => {
  it("restores Swatinem/rust-cache under its own key and saves only on a schedule run on master", () => {
    const cache = stepWithId(nativeSteps(TEXT), "rust-cache");
    expect(scalar(cache, "uses")).toBe("Swatinem/rust-cache@v2");
    const withBlock = topLevel(cache, "with");
    expect(scalar(withBlock, "key")).toBe("platform-advisory-${{ runner.os }}");
    const saveIf = scalar(withBlock, "save-if");
    const saves = (event: string, ref: string) => evaluateConjunction(saveIf, { "github.event_name": event, "github.ref": ref });
    expect([
      saves("schedule", "refs/heads/master"),
      saves("workflow_dispatch", "refs/heads/master"),
      saves("schedule", "refs/heads/ci-fault/platform"),
      saves("workflow_dispatch", "refs/heads/ci-fault/platform"),
    ]).toEqual([true, false, false, false]);
  });

  it("rejects a cache step without save-if, which rust-cache would save on every run", () => {
    expect(() => evaluateConjunction(null, {})).toThrow();
    expect(() => evaluateConjunction("${{ github.event_name == 'schedule' || github.ref == 'refs/heads/master' }}", { "github.event_name": "schedule", "github.ref": "x" })).toThrow();
  });
});

import { stepRun } from "../support/workflowBlocks";

const MARKER_NAME = "rust-cache hit";
const MARKER_IF = "steps.rust-cache.outputs.cache-hit == 'true'";

/**
 * The warm-cache marker pin (MIG003-r3-D29): the step directly after the one with id `rust-cache` is named exactly
 * `rust-cache hit`, runs only on an exact cache hit, and is a no-op that cannot fail. MIG-003d reads that step's
 * jobs-API conclusion (`success` warm, `skipped` cold). Throws, naming what broke.
 */
function assertWarmCacheMarker(text: string): void {
  const all = nativeSteps(text);
  const cacheAt = all.findIndex((s) => scalar(s, "id") === "rust-cache");
  if (cacheAt < 0) throw new Error("no step has id rust-cache");
  const marker = all[cacheAt + 1] ?? null;
  if (scalar(marker, "name") !== MARKER_NAME) throw new Error(`the step after rust-cache is not named exactly "${MARKER_NAME}"`);
  if (scalar(marker, "if") !== MARKER_IF) throw new Error(`the marker's if is not exactly ${MARKER_IF}`);
  if (scalar(marker, "uses") !== null) throw new Error("the marker uses an action");
  if (!/^(true|:|echo .*)$/.test(stepRun(marker ?? "") ?? "")) throw new Error("the marker's run is not a no-op");
}

describe("MIG-003b platform-advisory.yml warm-cache marker", () => {
  it("names a no-op step rust-cache hit, directly after the cache step, that runs only on an exact hit", () => {
    expect(() => assertWarmCacheMarker(TEXT)).not.toThrow();
  });

  it.each([
    ["renamed", "name: rust-cache hit", "name: rust-cache hits"],
    ["renamed with another case", "name: rust-cache hit", "name: Rust-cache hit"],
    ["renamed with a trailing space", "name: rust-cache hit", "name: 'rust-cache hit '"],
    ["its if negated", "cache-hit == 'true'", "cache-hit != 'true'"],
    ["its if pointing at another step", "if: steps.rust-cache.outputs", "if: steps.rustcache.outputs"],
    ["its if widened", "cache-hit == 'true'", "cache-hit == 'true' || true"],
    ["the cache step's id changed", "id: rust-cache", "id: rust_cache"],
    ["a step inserted before it", "      - name: rust-cache hit", "      - run: echo between\n\n      - name: rust-cache hit"],
    ["its run made to fail", "run: echo \"rust-cache restored an exact key match\"", "run: exit 1"],
  ])("rejects the marker %s", (_label, from, to) => {
    const mutant = TEXT.replace(from, to);
    expect(mutant).not.toBe(TEXT);
    expect(() => assertWarmCacheMarker(mutant)).toThrow();
  });
});

const stubIndex = (all: string[]) => all.findIndex((s) => (stepRun(s) ?? "").includes("src-tauri/binaries/mdpro_mcp-"));

describe("MIG-003b platform-advisory.yml sidecar stub", () => {
  it("stubs the sidecar in a bash step (Windows' default pwsh has no touch), after the marker", () => {
    const all = nativeSteps(TEXT);
    const at = stubIndex(all);
    expect(at).toBeGreaterThan(all.findIndex((s) => scalar(s, "name") === MARKER_NAME));
    expect(scalar(all[at] ?? null, "shell")).toBe("bash");
  });
});

import { execFile } from "node:child_process";
import os from "node:os";
import { afterAll } from "vitest";
import { spawnBudget } from "../support/spawnBudget";

const CHILD_TIMEOUT_MS = 10_000;
const stubRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mig003b-stub-"));
afterAll(() => fs.rmSync(stubRoot, { recursive: true, force: true }));

/** Run the workflow's stub script as Actions would (`bash -eo pipefail`), with a fake rustc reporting `host`. */
function runStub(runnerOs: string, host: string): Promise<string[]> {
  const dir = fs.mkdtempSync(path.join(stubRoot, "case-"));
  fs.mkdirSync(path.join(dir, "bin"));
  fs.mkdirSync(path.join(dir, "src-tauri", "binaries"), { recursive: true });
  fs.writeFileSync(path.join(dir, "src-tauri", "binaries", ".gitignore"), "*\n");
  fs.writeFileSync(path.join(dir, "bin", "rustc"), `#!/bin/sh\nprintf 'rustc 1.90.0\\nbinary: rustc\\nhost: ${host}\\nrelease: 1.90.0\\n'\n`, { mode: 0o755 });
  const script = stepRun(nativeSteps(TEXT)[stubIndex(nativeSteps(TEXT))] ?? "") ?? "exit 3";
  const env = { ...process.env, PATH: `${path.join(dir, "bin")}:${process.env.PATH ?? ""}`, RUNNER_OS: runnerOs };
  return new Promise((done, fail) => {
    execFile("bash", ["-eo", "pipefail", "-c", script], { cwd: dir, env, timeout: CHILD_TIMEOUT_MS, killSignal: "SIGKILL" }, (error) => {
      if (error) fail(error);
      else done(fs.readdirSync(path.join(dir, "src-tauri", "binaries")).sort());
    });
  });
}

describe("MIG-003b platform-advisory.yml sidecar stub script", () => {
  it("creates exactly the runner's triple, with .exe only on Windows", async () => {
    expect([
      await runStub("Windows", "x86_64-pc-windows-msvc"),
      await runStub("macOS", "aarch64-apple-darwin"),
    ]).toEqual([
      [".gitignore", "mdpro_mcp-x86_64-pc-windows-msvc.exe"],
      [".gitignore", "mdpro_mcp-aarch64-apple-darwin"],
    ]);
  }, spawnBudget(757));
});

const CHECK = "cargo check --manifest-path src-tauri/Cargo.toml --all-targets";
const CLIPPY = "cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings";
const runIndex = (all: string[], run: string) => all.findIndex((s) => stepRun(s) === run);

describe("MIG-003b platform-advisory.yml check and clippy", () => {
  it("checks all targets, then lints them with warnings denied, after the toolchain, cache, marker and stub", () => {
    const all = nativeSteps(TEXT);
    const order = [
      usesIndex(all, "dtolnay/rust-toolchain@"),
      all.findIndex((s) => scalar(s, "id") === "rust-cache"),
      all.findIndex((s) => scalar(s, "name") === MARKER_NAME),
      stubIndex(all),
      runIndex(all, CHECK),
      runIndex(all, CLIPPY),
    ];
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});

const TEST = "cargo test --manifest-path src-tauri/Cargo.toml 2>&1 | tee cargo-test.log";
const CHECKER = "node scripts/ci/cargo-test-summary.mjs cargo-test.log";

describe("MIG-003b platform-advisory.yml cargo test and checker", () => {
  it("pipes cargo test through tee in a bash step (so pipefail keeps its exit), then checks that same file", () => {
    const all = nativeSteps(TEXT);
    const testAt = runIndex(all, TEST);
    expect(testAt).toBeGreaterThan(runIndex(all, CLIPPY));
    expect(scalar(all[testAt] ?? null, "shell")).toBe("bash");
    expect(stepRun(all[testAt + 1] ?? "")).toBe(CHECKER);
    expect(all).toHaveLength(testAt + 2);
  });
});

/** Nothing skips or softens a leg or a build step, and nothing reaches clippy or cargo test through `env`. Throws. */
function assertNoSoftening(text: string): void {
  expect(keys(text)).toEqual(["name", "on", "permissions", "concurrency", "jobs"]);
  expect(keys(job(text, "native")).sort()).toEqual(["runs-on", "steps", "strategy", "timeout-minutes"]);
  const all = nativeSteps(text);
  for (const run of [CHECK, CLIPPY, TEST, CHECKER]) {
    const step = all[runIndex(all, run)] ?? null;
    expect(step).not.toBeNull();
    expect([entry(step, "if"), entry(step, "continue-on-error"), entry(step, "env")]).toEqual([null, null, null]);
  }
}

describe("MIG-003b platform-advisory.yml no softening", () => {
  it("has no top-level env or defaults, no job if, and no if, continue-on-error or env on the build steps", () => {
    expect(() => assertNoSoftening(TEXT)).not.toThrow();
  });

  it.each([
    ["a top-level RUSTFLAGS", "\njobs:\n", "\nenv:\n  RUSTFLAGS: --cap-lints=warn\n\njobs:\n"],
    ["a job if", "    timeout-minutes: 60\n", "    timeout-minutes: 60\n    if: github.ref == 'refs/heads/master'\n"],
    ["continue-on-error on the checker", `      - run: ${CHECKER}`, `      - continue-on-error: true\n        run: ${CHECKER}`],
    ["clippy only on macOS", `      - run: ${CLIPPY}`, `      - if: runner.os == 'macOS'\n        run: ${CLIPPY}`],
    ["an env on cargo test", "        shell: bash\n        run: cargo test", "        shell: bash\n        env:\n          RUSTFLAGS: --cap-lints=warn\n        run: cargo test"],
  ])("rejects %s", (_label, from, to) => {
    const mutant = TEXT.replace(from, to);
    expect(mutant).not.toBe(TEXT);
    expect(() => assertNoSoftening(mutant)).toThrow();
  });
});

describe("MIG-003b platform-advisory.yml cache save mutants", () => {
  it("fails the save pin when save-if is removed from the workflow", () => {
    const mutant = TEXT.replace(/\n {10}save-if: .*\n/, "\n");
    expect(mutant).not.toBe(TEXT);
    const saveIf = scalar(topLevel(stepWithId(nativeSteps(mutant), "rust-cache"), "with"), "save-if");
    expect(saveIf).toBeNull();
    expect(() => evaluateConjunction(saveIf, { "github.event_name": "schedule", "github.ref": "refs/heads/master" })).toThrow();
  });
});
