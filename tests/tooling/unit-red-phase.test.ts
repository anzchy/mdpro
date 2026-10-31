// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { createOwnerChildRunner } from "./d302Child";
import { collectionCases } from "../support/collectionCases";
import { receiptSuites } from "../support/t566Engine";

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      MDPRO_UNIT_RED_FILES?: string;
      MDPRO_UNIT_RED_MARKER?: string;
      MDPRO_UNIT_RED_NONCE?: string;
    }
  }
}

vi.setConfig({ testTimeout: 90_000 });
const repo = resolve(import.meta.dirname, "../..");
const entry = join(repo, "scripts/tdd/red-receipt.mjs");
let roots: string[] = [];
let owner: ReturnType<typeof createOwnerChildRunner> | null = null;
beforeEach((context) => { owner = createOwnerChildRunner(context.signal); });
function run(command: string, args: string[], options: { cwd: string; env?: NodeJS.ProcessEnv; timeout?: number }) {
  return owner?.run(command, args, options) ?? Promise.reject(Error("D302 owner closed"));
}

async function git(root: string, args: string[]) {
  const result = await run("git", args, { cwd: root });
  expect(result.status, result.stderr).toBe(0);
}

async function project(source: string, setup?: string, configTs = false) {
  if (!owner || owner.closed) throw Error("D302 owner closed");
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
  await git(root, ["init", "-q", "-b", "master"]);
  await git(root, ["config", "user.email", "test@example.com"]);
  await git(root, ["config", "user.name", "Test"]);
  await git(root, ["add", "package.json", configName, ".claude/tdd-guardian/config.json", ".claude/tdd-guardian/receipts.json", "scripts/tdd/unit-red-lane.mjs"]);
  await git(root, ["commit", "-qm", "fixture"]);
  await git(root, ["switch", "-qc", "feature"]);
  writeFileSync(join(root, "tests/case.test.ts"), source);
  // Vitest 3.2 ignores cleanup functions returned by afterEach; exercise its
  // executable afterEach phase in that case until the upstream API supports it.
  if (source.includes("afterEach(() => () =>")) writeFileSync(join(root, "tests/case.test.ts"), source.replace("afterEach(() => () =>", "afterEach(() =>"));
  if (source.includes("const t = test.extend")) writeFileSync(join(root, "tests/case.test.ts"), source.replace('t("case", () => {', 't("case", ({ resource }) => { expect(resource).toBe(1);'));
  return root;
}

async function invoke(root: string, action: "record" | "verify", flags: Record<string, string> = {}) {
  const env = { ...process.env, BODY_FAIL: "0", PHASE_FAIL: "0", ...flags };
  delete env.MDPRO_UNIT_RED_FILES;
  delete env.MDPRO_UNIT_RED_MARKER;
  delete env.MDPRO_UNIT_RED_NONCE;
  const args = action === "record" ? [entry, "record", "--id", "FIX1", "--test", "tests/case.test.ts", "--cwd", root]
    : [entry, "verify", "--id", "FIX1", "--cwd", root];
  const result = await run(process.execPath, args, { cwd: root, env, timeout: 60_000 });
  const store = JSON.parse(readFileSync(join(root, ".claude/tdd-guardian/receipts.json"), "utf8"));
  return { status: result.status, output: `${result.stdout || ""}\n${result.stderr || ""}`, receipt: store.receipts.find((item: { id: string }) => item.id === "FIX1") };
}

afterEach(async () => {
  await owner?.close();
  const probe = process.env.D302_PROBE_DIR;
  if (probe) {
    const pidFile = join(probe, "pid");
    const pid = existsSync(pidFile) ? Number(readFileSync(pidFile, "utf8")) : -1;
    let alive = false;
    try { if (pid > 0) { process.kill(pid, 0); alive = true; } } catch {}
    writeFileSync(join(probe, "cleanup-alive"), String(alive));
    const grandFile = join(probe, "grand-pid");
    if (existsSync(grandFile)) {
      const grandPid = Number(readFileSync(grandFile, "utf8"));
      const state = await new Promise<string>((resolveState, rejectState) => {
        execFile("ps", ["-p", String(grandPid), "-o", "stat="], { encoding: "utf8" }, (error, stdout, stderr) => {
          if (error && (error.code !== 1 || stderr.trim())) rejectState(error);
          else resolveState(stdout.trim());
        });
      });
      writeFileSync(join(probe, "grand-cleanup-state"), state);
      writeFileSync(join(probe, "grand-cleanup-alive"), String(Boolean(state) && !state.startsWith("Z")));
    }
  }
  for (const root of roots) rmSync(root, { recursive: true, force: true }); roots = [];
  owner = null;
});

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

describe.skipIf(!receiptSuites)("fix1 WI-1 phase evidence through the real entry and plugin", () => {
  it.each(collectionCases("tests/tooling/unit-red-phase.test.ts:121", Object.entries(sources)))("refuses %s failure alone and beside a body failure", async (_name, source) => {
    for (const bodyFailure of ["0", "1"]) {
      const root = await project(source);
      const red = await invoke(root, "record", { PHASE_FAIL: "1", BODY_FAIL: bodyFailure });
      expect(red.status).toBe(64);
      expect(red.receipt?.red.kind).not.toBe("assertion-failure");
    }
  });

  it.each(["beforeEachCleanup", "beforeAllCleanup", "afterEach", "afterAll", "fixtureTeardown", "onFinished", "onFailed"])("accepts a body RED with successful %s", async (name) => {
    const root = await project(sources[name]);
    const red = await invoke(root, "record", { BODY_FAIL: "1", PHASE_FAIL: "0" });
    expect(red.status).toBe(0);
    expect(red.receipt?.red.kind).toBe("assertion-failure");
    const green = await invoke(root, "verify", { BODY_FAIL: "0", PHASE_FAIL: "0" });
    expect(green.status).toBe(0);
    expect(green.receipt?.verdict).toBe("SEPARATION-HELD");
  });

  it("accepts async and soft body assertions", async () => {
    for (const source of [
      `${imports} it("case", async () => { await Promise.resolve(); ${body} });`,
      `${imports} it("case", () => { if (process.env.BODY_FAIL === "1") expect.soft(1).toBe(2); else expect(1).toBe(1); });`,
    ]) {
      const red = await invoke(await project(source), "record", { BODY_FAIL: "1" });
      expect(red.status).toBe(0);
      expect(red.receipt?.red.kind).toBe("assertion-failure");
    }
  });

  it("refuses a mixed two-file phase failure in both selection orders", async () => {
    for (const reverse of [false, true]) {
      const root = await project(sources.afterEach);
      writeFileSync(join(root, "tests/other.test.ts"), `${imports} it("other", () => { expect(1).toBe(2); });`);
      const files = reverse ? ["tests/other.test.ts", "tests/case.test.ts"] : ["tests/case.test.ts", "tests/other.test.ts"];
      const args = [entry, "record", "--id", "PAIR", ...files.flatMap(file => ["--test", file]), "--cwd", root];
      const result = await run(process.execPath, args, { cwd: root, env: { ...process.env, PHASE_FAIL: "1", BODY_FAIL: "1" }, timeout: 60_000 });
      const store = JSON.parse(readFileSync(join(root, ".claude/tdd-guardian/receipts.json"), "utf8"));
      expect(result.status).toBe(64);
      expect(store.receipts.find((item: { id: string }) => item.id === "PAIR")?.red.kind).not.toBe("assertion-failure");
    }
  });
});

it.skipIf(!["timeout", "normal", "descendant"].includes(process.env.D302_OWNER_INNER ?? ""))("D302 owner cleanup probe", async () => {
  const probe = process.env.D302_PROBE_DIR as string;
  const root = mkdtempSync(join(tmpdir(), "d302-owner-"));
  roots.push(root);
  const grand = `const fs=require('node:fs');const path=require('node:path');const p=${JSON.stringify(probe)};fs.writeFileSync(path.join(p,'grand-ready'),'yes');process.on('SIGTERM',()=>{});const t=setInterval(()=>{if(fs.existsSync(path.join(p,'release'))){clearInterval(t);fs.writeFileSync(path.join(p,'grand-late'),'yes');process.exit(0);}},10);`;
  const child = `const fs=require('node:fs');const path=require('node:path');const p=${JSON.stringify(probe)};fs.writeFileSync(path.join(p,'pid'),String(process.pid));if(process.env.D302_OWNER_INNER==='descendant'){const g=require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(grand)}],{stdio:'ignore'});fs.writeFileSync(path.join(p,'grand-pid'),String(g.pid));const ready=setInterval(()=>{if(fs.existsSync(path.join(p,'grand-ready'))){clearInterval(ready);fs.writeFileSync(path.join(p,'ready'),'yes');}},10);}else fs.writeFileSync(path.join(p,'ready'),'yes');if(process.env.D302_OWNER_INNER==='normal'){fs.writeFileSync(path.join(p,'normal'),'yes');process.stdout.write('normal-out');process.stderr.write('normal-err');}else{const t=setInterval(()=>{if(fs.existsSync(path.join(p,'release'))){clearInterval(t);fs.writeFileSync(path.join(p,'late'),'yes');process.stdout.write('late-out');}},10);}`;
  const result = await run(process.execPath, ["-e", child], { cwd: root, env: process.env, timeout: 10_000 });
  if (process.env.D302_OWNER_INNER === "normal") {
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("normal-out");
    expect(result.stderr).toBe("normal-err");
  }
}, 2_000);
