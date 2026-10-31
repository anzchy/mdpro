// @vitest-environment node
/**
 * T566-3 (#566 AC-4): a missing or broken vendored engine makes the receipt entry exit
 * nonzero with a message naming the vendored directory. It never falls back to a plugin
 * cache: the HOME here holds poisoned Claude and Codex caches that write a marker if run.
 * The entry runs from a copy of `scripts/tdd/` under a `"type": "module"` root, as in the repo.
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ENGINE_VERSION, homeEnv, makeHome, repoRoot, rustfmt, vendorDir } from "../support/t566Engine";
import { createReceiptRepo, type ReceiptRepo } from "./adr0149eRepo";

vi.setConfig({ testTimeout: 180_000 });
let repo: ReceiptRepo;
let home: { home: string; marker: string };
let tree: string;
let engine: string;
beforeEach(async (context) => {
  repo = await createReceiptRepo(context.signal);
  home = makeHome(true);
  tree = realpathSync(mkdtempSync(join(tmpdir(), "mdpro-t566-entry-")));
  writeFileSync(join(tree, "package.json"), '{"type":"module"}\n');
  mkdirSync(join(tree, "scripts/tdd"), { recursive: true });
  for (const file of readdirSync(join(repoRoot, "scripts/tdd")).filter((name) => name.endsWith(".mjs"))) {
    cpSync(join(repoRoot, "scripts/tdd", file), join(tree, "scripts/tdd", file));
  }
  engine = join(tree, `scripts/tdd/vendor/tdd-guardian-${ENGINE_VERSION}`);
  if (existsSync(vendorDir)) cpSync(vendorDir, engine, { recursive: true });
  repo.write("src/calc.mjs", "export const value = () => 1;\n");
  await repo.commit("base production");
  await repo.git("branch", "-f", "master", "HEAD");
  repo.write("tests/calc.test.ts", 'import { expect, it } from "vitest";\nimport { value } from "../src/calc.mjs";\nit("value", () => {\n  expect(value()).toBe(2);\n});\n');
  await repo.commit("spec");
});
afterEach(async () => {
  await repo.close();
  rmSync(home.home, { recursive: true, force: true });
  rmSync(tree, { recursive: true, force: true });
});

const entry = (...args: string[]) => repo.run(process.execPath, [join(tree, "scripts/tdd/red-receipt.mjs"), ...args, "--cwd", repo.root], homeEnv(home.home));
const storeBytes = () => readFileSync(join(repo.root, ".claude/tdd-guardian/receipts.json"), "utf8");

/** The entry refused, named the vendored directory (and `file`), ran no cache, and left the store as it was. */
async function expectClosed(result: { status: number | null; output: string }, before: string, file?: string) {
  expect(result.status, result.output).not.toBe(0);
  expect(result.output).toContain(engine);
  if (file) expect(result.output).toContain(file);
  expect(existsSync(home.marker), "a plugin cache ran").toBe(false);
  expect(storeBytes()).toBe(before);
}
const record = () => entry("record", "--id", "A", "--test", "tests/calc.test.ts");

describe("T566-3 a missing or broken vendored engine fails closed", () => {
  it("refuses to record without receipt.js, before the lane runs", async () => {
    rmSync(join(engine, "receipt.js"), { force: true });
    await expectClosed(await record(), storeBytes(), "receipt.js");
    expect(await repo.refs()).toEqual([]);
  });

  it("refuses check-pending, verify, discard and replay without lib/verification.js", async () => {
    const recorded = await record();
    expect(recorded.status, recorded.output).toBe(0);
    rmSync(join(engine, "lib/verification.js"), { force: true });
    const before = storeBytes();
    for (const args of [["check-pending"], ["verify", "--id", "A"], ["discard", "--id", "A"], ["replay", "--id", "A", "--base", "master"]]) {
      await expectClosed(await entry(...args), before, "lib/verification.js");
    }
  });

  it("refuses check-pending on a branch with no receipts of its own, so the load is never skipped", async () => {
    rmSync(join(engine, "lib/verification.js"), { force: true });
    const before = storeBytes();
    expect(JSON.parse(before).receipts).toEqual([]);
    const result = await entry("check-pending");
    expect(result.status, result.output).toBe(64);
    expect(result.stderr).toContain(`[red-receipt] The vendored receipt engine at ${engine} is unusable: lib/verification.js is missing.`);
    expect(result.stdout).not.toMatch(/No unsettled/);
    await expectClosed(result, before, "lib/verification.js");
  });

  it("refuses to record when lib/config.js does not load", async () => {
    expect(existsSync(join(engine, "lib/config.js"))).toBe(true);
    writeFileSync(join(engine, "lib/config.js"), "const broken = ;\n");
    await expectClosed(await record(), storeBytes(), "lib/config.js");
  });

  it("refuses to record when receipt.js does not compile, before the lane runs", async () => {
    expect(existsSync(join(engine, "receipt.js"))).toBe(true);
    writeFileSync(join(engine, "receipt.js"), "#!/usr/bin/env node\nconst broken = ;\n");
    await expectClosed(await record(), storeBytes(), "receipt.js");
    expect(await repo.refs()).toEqual([]);
    expect(existsSync(join(repo.root, ".claude/tdd-guardian/evidence.json"))).toBe(false);
  });

  it("refuses to record when the vendored directory is gone", async () => {
    rmSync(engine, { recursive: true, force: true });
    await expectClosed(await record(), storeBytes());
  });

  it.each([
    ["deleted", null],
    ["set to ESM", '{"type":"module"}\n'],
  ])("refuses to record when the CommonJS shim is %s", async (_name, text) => {
    expect(existsSync(join(engine, "package.json"))).toBe(true);
    if (text === null) rmSync(join(engine, "package.json"));
    else writeFileSync(join(engine, "package.json"), text);
    await expectClosed(await record(), storeBytes());
    expect(await repo.refs()).toEqual([]);
  });

  it("never runs a cache for an invalid id with the engine gone", async () => {
    rmSync(engine, { recursive: true, force: true });
    const result = await entry("record", "--id", "bad id", "--test", "tests/calc.test.ts");
    expect(result.status, result.output).not.toBe(0);
    expect(existsSync(home.marker)).toBe(false);
    expect(JSON.parse(storeBytes()).receipts).toEqual([]);
  });
});

describe.skipIf(!rustfmt)("T566-3 the rust lane fails closed", () => {
  it("refuses to record a rust RED without receipt.js", async () => {
    repo.write("src-tauri/Cargo.toml", '[package]\nname = "tauri-app"\nversion = "0.0.0"\nedition = "2021"\n');
    repo.write("src-tauri/src/x_tests.rs", "#[test]\nfn f() {\n    assert!(false);\n}\n");
    await repo.commit("rust fixture");
    rmSync(join(engine, "receipt.js"), { force: true });
    await expectClosed(await entry("record", "--id", "R", "--lane", "rust", "--test", "src-tauri/src/x_tests.rs"), storeBytes(), "receipt.js");
  });
});
