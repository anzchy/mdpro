// @vitest-environment node
/**
 * ADR0149E-8 (AC-8, ADR-0145 d8): Rust REDs go through the entry. It validates the Rust
 * spec paths and refuses any file rustfmt (at the crate's edition) would rewrite before
 * the lane runs; `cargo-test-lane.mjs` tees its raw output for the evidence; `verify
 * --lane rust` judges on the rust lane.
 */
import { spawn, type SpawnOptions } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, symlinkSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createReceiptRepo, pluginVersion, repo as repoRoot, type ReceiptRepo } from "./adr0149eRepo";

vi.setConfig({ testTimeout: 180_000 });
const toolchains = join(homedir(), ".rustup/toolchains");
const rustfmt = [
  ...(process.env.PATH ?? "").split(":").map((dir) => join(dir, "rustfmt")),
  join(homedir(), ".cargo/bin/rustfmt"),
  ...(existsSync(toolchains) ? readdirSync(toolchains).map((name) => join(toolchains, name, "bin/rustfmt")) : []),
].find((path) => existsSync(path));
let repo: ReceiptRepo;
beforeEach(async (context) => { repo = await createReceiptRepo(context.signal); });
afterEach(async () => { await repo.close(); });

const red = (name: string) => `\nrunning 1 test\ntest ${name} ... FAILED\n\nfailures:\n\n---- ${name} stdout ----\n\nthread '${name}' (3) panicked at src/x_tests.rs:3:5:\nassertion failed: false\n\nfailures:\n    ${name}\n\ntest result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s\n`;
const green = (name: string) => `\nrunning 1 test\ntest ${name} ... ok\n\ntest result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s\n`;
const running = "     Running unittests src/lib.rs (target/debug/deps/tauri_app_lib-0123456789abcdef)\n";
const clean = "#[test]\nfn f() {\n    assert!(false);\n}\n";

async function rustFixture(files: Record<string, string>, edition = "2021") {
  repo.write("src-tauri/Cargo.toml", `[package]\nname = "tauri-app"\nversion = "0.0.0"\nedition = "${edition}"\n`);
  for (const [path, text] of Object.entries(files)) repo.write(path, text);
  repo.cargoOutput(red("x_tests::f"), running, 101);
  await repo.commit("rust fixture");
  await repo.run("rm", ["-f", "fake-cargo/ran"]);
}

describe.skipIf(!pluginVersion || !rustfmt)("ADR0149E-8 rust lane through the entry", () => {
  it("refuses an unformatted spec file before the lane runs", async () => {
    await rustFixture({ "src-tauri/src/x_tests.rs": "#[test]\nfn f(){assert!(false);}\n" });
    const result = await repo.entry("record", "--id", "R", "--lane", "rust", "--test", "src-tauri/src/x_tests.rs");
    expect(result.status, result.output).toBe(64);
    expect(result.output).toMatch(/rustfmt/);
    expect(existsSync(join(repo.root, "fake-cargo/ran"))).toBe(false);
    expect(repo.store()).toEqual([]);
  });

  it("formats at the crate's edition and checks every spec file", async () => {
    const asyncFn = "pub async fn g() {}\n\n#[test]\nfn f() {\n    assert!(false);\n}\n";
    await rustFixture({ "src-tauri/src/x_tests.rs": asyncFn, "src-tauri/src/y_tests.rs": "fn  y() {}\n" });
    const twoFiles = await repo.entry("record", "--id", "R", "--lane", "rust", "--test", "src-tauri/src/x_tests.rs", "--test", "src-tauri/src/y_tests.rs");
    expect(twoFiles.status, twoFiles.output).toBe(64);
    expect(twoFiles.output).toMatch(/y_tests\.rs/);
    expect(existsSync(join(repo.root, "fake-cargo/ran"))).toBe(false);
    const recorded = await repo.entry("record", "--id", "R", "--lane", "rust", "--test", "src-tauri/src/x_tests.rs");
    expect(recorded.status, recorded.output).toBe(0);
    expect(repo.store().map((receipt) => [receipt.id, receipt.lane])).toEqual([["R", "rust"]]);
    repo.write("src-tauri/Cargo.toml", '[package]\nname = "tauri-app"\nversion = "0.0.0"\nedition = "2015"\n');
    await repo.run("rm", ["-f", "fake-cargo/ran"]);
    const old = await repo.entry("record", "--id", "S", "--lane", "rust", "--test", "src-tauri/src/x_tests.rs");
    expect(old.status, old.output).toBe(64);
    expect(existsSync(join(repo.root, "fake-cargo/ran"))).toBe(false);
  });

  it("refuses Rust spec paths outside src-tauri, of another type, symlinked or missing", async () => {
    await rustFixture({ "src-tauri/src/x_tests.rs": clean, "src/x.rs": clean, "src-tauri/a.txt": "x" });
    symlinkSync("x_tests.rs", join(repo.root, "src-tauri/src/l.rs"));
    for (const path of ["src/x.rs", "src-tauri/a.txt", "src-tauri/src/l.rs", "src-tauri/src/missing.rs", "tests/a.test.ts", "src-tauri/../src/x.rs"]) {
      const result = await repo.entry("record", "--id", "R", "--lane", "rust", "--test", path);
      expect(result.status, path).toBe(64);
    }
    expect(repo.store()).toEqual([]);
    expect((await repo.entry("record", "--id", "R", "--lane", "slow", "--test", "src-tauri/src/x_tests.rs")).status).toBe(64);
  });

  it("verifies a rust receipt on the rust lane", async () => {
    await rustFixture({ "src-tauri/src/x_tests.rs": clean });
    expect((await repo.entry("record", "--id", "R", "--lane", "rust", "--test", "src-tauri/src/x_tests.rs")).status).toBe(0);
    repo.cargoOutput(green("x_tests::f"), running, 0);
    await repo.run("rm", ["-f", "fake-cargo/ran"]);
    const verified = await repo.entry("verify", "--id", "R", "--lane", "rust");
    expect(verified.status, verified.output).toBe(0);
    expect(existsSync(join(repo.root, "fake-cargo/ran"))).toBe(true);
    expect(repo.store()[0].verdict).toBe("SEPARATION-HELD");
  });
});

describe("ADR0149E-8 cargo-test-lane evidence tee", () => {
  const wrapper = join(repoRoot, "scripts/cargo-test-lane.mjs");
  const child = 'process.stdout.write(Buffer.from([0x61, 0xff, 0x0a])); process.stderr.write("err\\n"); process.exitCode = 3;';
  const runWrapper = (options: SpawnOptions) => new Promise<{ status: number | null; stdout: Buffer; stderr: Buffer }>((resolve, reject) => {
    const proc = spawn(process.execPath, [wrapper, process.execPath, "-e", child], { ...options, stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    proc.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
    proc.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
    proc.on("error", reject);
    proc.on("close", (status) => resolve({ status, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) }));
  });
  it("writes stdout.log and stderr.log byte-identical to what it passed through when MDPRO_RED_EVIDENCE_DIR is set", async () => {
    const dir = mkdtempSync(join(tmpdir(), "adr0149e-tee-"));
    const run = await runWrapper({ env: { ...process.env, MDPRO_RED_EVIDENCE_DIR: dir } });
    expect(run.status).toBe(3);
    expect(readFileSync(join(dir, "stdout.log"))).toEqual(run.stdout);
    expect(readFileSync(join(dir, "stderr.log"))).toEqual(run.stderr);
    expect(run.stdout).toEqual(Buffer.from([0x61, 0xff, 0x0a]));
  });
  it("writes nothing when MDPRO_RED_EVIDENCE_DIR is unset", async () => {
    const dir = mkdtempSync(join(tmpdir(), "adr0149e-tee-"));
    const env = { ...process.env };
    delete env.MDPRO_RED_EVIDENCE_DIR;
    const run = await runWrapper({ cwd: dir, env });
    expect(run.status).toBe(3);
    expect(readdirSync(dir)).toEqual([]);
  });
});
