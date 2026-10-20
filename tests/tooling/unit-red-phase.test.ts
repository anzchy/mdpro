// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      MDPRO_UNIT_RED_FILES?: string;
      MDPRO_UNIT_RED_MARKER?: string;
      MDPRO_UNIT_RED_NONCE?: string;
    }
  }
}

vi.setConfig({ testTimeout: 30_000 });
const repo = resolve(import.meta.dirname, "../..");
const entry = join(repo, "scripts/tdd/red-receipt.mjs");
const pluginCache = join(homedir(), ".claude/plugins/cache/xiaolai/tdd-guardian");
const hasPlugin = existsSync(pluginCache);
let roots: string[] = [];

function git(root: string, args: string[]) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  expect(result.status, result.stderr).toBe(0);
}

function project(source: string, setup?: string, configTs = false) {
  const root = mkdtempSync(join(tmpdir(), "mdpro-phase-fix1-"));
  roots.push(root);
  mkdirSync(join(root, "tests"));
  mkdirSync(join(root, ".claude/tdd-guardian"), { recursive: true });
  mkdirSync(join(root, "scripts/tdd"), { recursive: true });
  symlinkSync(join(repo, "node_modules"), join(root, "node_modules"));
  symlinkSync(join(repo, "scripts/tdd/unit-red-lane.mjs"), join(root, "scripts/tdd/unit-red-lane.mjs"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ type: "module" }));
  const configName = configTs ? "vitest.config.ts" : "vitest.config.mjs";
  const testConfig = configTs
    ? 'import { defineConfig } from "vitest/config"; export default defineConfig({ test: { include: ["tests/**/*.test.ts"], environment: "jsdom", setupFiles: ["tests/setup.ts"], maxWorkers: 2 } });\n'
    : 'export default {test:{include:["tests/**/*.test.ts"],maxWorkers:2}};\n';
  writeFileSync(join(root, configName), testConfig);
  if (setup) writeFileSync(join(root, "tests/setup.ts"), setup);
  writeFileSync(join(root, ".claude/tdd-guardian/config.json"), readFileSync(join(repo, ".claude/tdd-guardian/config.json")));
  writeFileSync(join(root, ".claude/tdd-guardian/receipts.json"), JSON.stringify({ schemaVersion: 2, receipts: [] }));
  git(root, ["init", "-q", "-b", "master"]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "Test"]);
  git(root, ["add", "package.json", configName, ".claude/tdd-guardian/config.json", ".claude/tdd-guardian/receipts.json", "scripts/tdd/unit-red-lane.mjs"]);
  git(root, ["commit", "-qm", "fixture"]);
  git(root, ["switch", "-qc", "feature"]);
  writeFileSync(join(root, "tests/case.test.ts"), source);
  // Vitest 3.2 ignores cleanup functions returned by afterEach; exercise its
  // executable afterEach phase in that case until the upstream API supports it.
  if (source.includes("afterEach(() => () =>")) writeFileSync(join(root, "tests/case.test.ts"), source.replace("afterEach(() => () =>", "afterEach(() =>"));
  if (source.includes("const t = test.extend")) writeFileSync(join(root, "tests/case.test.ts"), source.replace('t("case", () => {', 't("case", ({ resource }) => { expect(resource).toBe(1);'));
  return root;
}

function invoke(root: string, action: "record" | "verify", flags: Record<string, string> = {}) {
  const env = { ...process.env, BODY_FAIL: "0", PHASE_FAIL: "0", ...flags };
  delete env.MDPRO_UNIT_RED_FILES;
  delete env.MDPRO_UNIT_RED_MARKER;
  delete env.MDPRO_UNIT_RED_NONCE;
  const args = action === "record" ? [entry, "record", "--id", "FIX1", "--test", "tests/case.test.ts", "--cwd", root]
    : [entry, "verify", "--id", "FIX1", "--cwd", root];
  const result = spawnSync(process.execPath, args, { cwd: root, env, encoding: "utf8", timeout: 60_000 });
  const store = JSON.parse(readFileSync(join(root, ".claude/tdd-guardian/receipts.json"), "utf8"));
  return { status: result.status, output: `${result.stdout || ""}\n${result.stderr || ""}`, receipt: store.receipts.find((item: { id: string }) => item.id === "FIX1") };
}

afterEach(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); roots = []; });

const body = 'if (process.env.BODY_FAIL === "1") expect(1).toBe(2); else expect(1).toBe(1);';
const imports = 'import { it, expect, beforeEach, beforeAll, afterEach, afterAll, describe, onTestFinished, onTestFailed, test } from "vitest";';
const sources: Record<string, string> = {
  beforeEachCleanup: `${imports} beforeEach(() => () => { if (process.env.PHASE_FAIL === "1") throw Error("red"); }); it("case", () => { ${body} });`,
  beforeAllCleanup: `${imports} beforeAll(() => () => { if (process.env.PHASE_FAIL === "1") throw Error("red"); }); it("case", () => { ${body} });`,
  afterEach: `${imports} afterEach(() => { if (process.env.PHASE_FAIL === "1") throw Error("red"); }); it("case", () => { ${body} });`,
  afterAll: `${imports} afterAll(() => { if (process.env.PHASE_FAIL === "1") throw Error("red"); }); it("case", () => { ${body} });`,
  afterEachCleanup: `${imports} afterEach(() => () => { if (process.env.PHASE_FAIL === "1") throw Error("red"); }); it("case", () => { ${body} });`,
  fixtureTeardown: `${imports} const t = test.extend({ resource: async ({}, use) => { await use(1); if (process.env.PHASE_FAIL === "1") throw Error("red"); } }); t("case", () => { ${body} });`,
  onFinished: `${imports} it("case", () => { onTestFinished(() => { if (process.env.PHASE_FAIL === "1") throw Error("red"); }); ${body} });`,
  onFailed: `${imports} it("case", () => { onTestFailed(() => { if (process.env.PHASE_FAIL === "1") throw Error("red"); }); ${body} });`,
  timeout: `${imports} it("case", async () => { if (process.env.PHASE_FAIL === "1") await new Promise(() => {}); ${body} }, 20);`,
};

describe.skipIf(!hasPlugin)("fix1 WI-1 phase evidence through the real entry and plugin", () => {
  it.each(Object.entries(sources))("refuses %s failure alone and beside a body failure", (_name, source) => {
    for (const bodyFailure of ["0", "1"]) {
      const root = project(source);
      const red = invoke(root, "record", { PHASE_FAIL: "1", BODY_FAIL: bodyFailure });
      expect(red.status).toBe(64);
      expect(red.receipt?.red.kind).not.toBe("assertion-failure");
    }
  });

  it.each(["beforeEachCleanup", "beforeAllCleanup", "afterEach", "afterAll", "fixtureTeardown", "onFinished", "onFailed"])("accepts a body RED with successful %s", (name) => {
    const root = project(sources[name]);
    const red = invoke(root, "record", { BODY_FAIL: "1", PHASE_FAIL: "0" });
    expect(red.status).toBe(0);
    expect(red.receipt?.red.kind).toBe("assertion-failure");
    const green = invoke(root, "verify", { BODY_FAIL: "0", PHASE_FAIL: "0" });
    expect(green.status).toBe(0);
    expect(green.receipt?.verdict).toBe("SEPARATION-HELD");
  });

  it("accepts async and soft body assertions", () => {
    for (const source of [
      `${imports} it("case", async () => { await Promise.resolve(); ${body} });`,
      `${imports} it("case", () => { if (process.env.BODY_FAIL === "1") expect.soft(1).toBe(2); else expect(1).toBe(1); });`,
    ]) {
      const red = invoke(project(source), "record", { BODY_FAIL: "1" });
      expect(red.status).toBe(0);
      expect(red.receipt?.red.kind).toBe("assertion-failure");
    }
  });

  it("refuses a mixed two-file phase failure in both selection orders", () => {
    for (const reverse of [false, true]) {
      const root = project(sources.afterEach);
      writeFileSync(join(root, "tests/other.test.ts"), `${imports} it("other", () => { expect(1).toBe(2); });`);
      const files = reverse ? ["tests/other.test.ts", "tests/case.test.ts"] : ["tests/case.test.ts", "tests/other.test.ts"];
      const args = [entry, "record", "--id", "PAIR", ...files.flatMap(file => ["--test", file]), "--cwd", root];
      const result = spawnSync(process.execPath, args, { cwd: root, env: { ...process.env, PHASE_FAIL: "1", BODY_FAIL: "1" }, encoding: "utf8", timeout: 60_000 });
      const store = JSON.parse(readFileSync(join(root, ".claude/tdd-guardian/receipts.json"), "utf8"));
      expect(result.status).toBe(64);
      expect(store.receipts.find((item: { id: string }) => item.id === "PAIR")?.red.kind).not.toBe("assertion-failure");
    }
  });
});
