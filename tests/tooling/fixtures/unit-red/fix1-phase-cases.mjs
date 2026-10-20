import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const [name, repo] = process.argv.slice(2);
const root = mkdtempSync(join(tmpdir(), "mdpro-phase-advanced-"));
const entry = join(repo, "scripts/tdd/red-receipt.mjs");
const body = 'if (process.env.BODY_FAIL === "1") expect(1).toBe(2); else expect(1).toBe(1);';
const imports = 'import { it, test, expect, beforeEach, beforeAll, afterEach, afterAll, describe, onTestFinished, onTestFailed } from "vitest";';

function git(args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.status) throw Error(result.stderr);
}

function setup(source, tsConfig = false) {
  mkdirSync(join(root, "tests")); mkdirSync(join(root, ".claude/tdd-guardian"), { recursive: true }); mkdirSync(join(root, "scripts/tdd"), { recursive: true });
  symlinkSync(join(repo, "node_modules"), join(root, "node_modules"));
  symlinkSync(join(repo, "scripts/tdd/unit-red-lane.mjs"), join(root, "scripts/tdd/unit-red-lane.mjs"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ type: "module" }));
  const configName = tsConfig ? "vitest.config.ts" : "vitest.config.mjs";
  const config = tsConfig
    ? 'import { defineConfig } from "vitest/config"; export default defineConfig({ test: { include: ["tests/**/*.test.ts"], environment: "jsdom", setupFiles: ["tests/setup.ts"], maxWorkers: 2 } });\n'
    : 'export default {test:{include:["tests/**/*.test.ts"],maxWorkers:2}};\n';
  writeFileSync(join(root, configName), config);
  if (tsConfig) writeFileSync(join(root, "tests/setup.ts"), 'import { afterEach } from "vitest"; import { writeFileSync } from "node:fs"; globalThis.__phaseSetup = true; writeFileSync("setup-reached", "yes"); afterEach(() => { if (process.env.PHASE_FAIL === "1") throw Error("red"); });\n');
  writeFileSync(join(root, ".claude/tdd-guardian/config.json"), readFileSync(join(repo, ".claude/tdd-guardian/config.json")));
  writeFileSync(join(root, ".claude/tdd-guardian/receipts.json"), JSON.stringify({ schemaVersion: 2, receipts: [] }));
  git(["init", "-q", "-b", "master"]); git(["config", "user.email", "test@example.com"]); git(["config", "user.name", "Test"]);
  const paths = ["package.json", configName, ".claude/tdd-guardian/config.json", ".claude/tdd-guardian/receipts.json", "scripts/tdd/unit-red-lane.mjs"];
  if (tsConfig) paths.push("tests/setup.ts");
  git(["add", ...paths]); git(["commit", "-qm", "fixture"]); git(["switch", "-qc", "feature"]);
  writeFileSync(join(root, "tests/case.test.ts"), source);
}

function invoke(action, flags = {}) {
  const env = { ...process.env, BODY_FAIL: "0", PHASE_FAIL: "0", ...flags };
  delete env.MDPRO_UNIT_RED_FILES; delete env.MDPRO_UNIT_RED_MARKER; delete env.MDPRO_UNIT_RED_NONCE;
  const args = action === "record" ? [entry, "record", "--id", "ADV", "--test", "tests/case.test.ts", "--cwd", root]
    : [entry, "verify", "--id", "ADV", "--cwd", root];
  const result = spawnSync(process.execPath, args, { cwd: root, env, encoding: "utf8", timeout: 60_000 });
  const store = JSON.parse(readFileSync(join(root, ".claude/tdd-guardian/receipts.json"), "utf8"));
  return { status: result.status, kind: store.receipts[0]?.red.kind || null, verdict: store.receipts[0]?.verdict || null, output: `${result.stdout || ""}\n${result.stderr || ""}` };
}

function sourceFor(which) {
  const fail = 'if (process.env.PHASE_FAIL === "1") throw Error("red");';
  const expectFail = 'if (process.env.PHASE_FAIL === "1") expect(1).toBe(2);';
  switch (which) {
    case "nestedBeforeAllAlone": return sourceFor("nestedBeforeAll");
    case "nestedAfterAllAlone": return sourceFor("nestedAfterAll");
    case "nestedParentBeforeEachAlone": return sourceFor("nestedParentBeforeEach");
    case "nestedBeforeAll": return `${imports} describe("inner", () => { beforeAll(() => () => { ${fail} }); it("case", () => { ${body} }); });`;
    case "nestedAfterAll": return `${imports} describe("inner", () => { afterAll(() => { ${fail} }); it("case", () => { ${body} }); });`;
    case "nestedParentBeforeEach": return `${imports} describe("parent", () => { beforeEach(() => () => { ${fail} }); describe("inner", () => { it("case", () => { ${body} }); }); });`;
    case "afterEachExpect": return `${imports} afterEach(() => { ${expectFail} }); it("case", () => { ${body} });`;
    case "cleanupExpect": return `${imports} beforeEach(() => () => { ${expectFail} }); it("case", () => { ${body} });`;
    case "afterEachSoft": return `${imports} afterEach(() => { if (process.env.PHASE_FAIL === "1") expect.soft(1).toBe(2); }); it("case", () => { ${body} });`;
    case "cleanupSoft": return `${imports} beforeEach(() => () => { if (process.env.PHASE_FAIL === "1") expect.soft(1).toBe(2); }); it("case", () => { ${body} });`;
    case "fixtureExpect": return `${imports} const t=test.extend({ resource: async ({}, use) => { await use(1); if(process.env.PHASE_FAIL==="1") expect(1).toBe(2); } }); t("case",({resource})=>{expect(resource).toBe(1);${body}});`;
    case "fixtureSetupThrow": return `${imports} const t=test.extend({ resource: async ({}, use) => { if(process.env.PHASE_FAIL==="1") throw Error("red"); await use(1); } }); t("case",({resource})=>{expect(resource).toBe(1);${body}});`;
    case "fixturePrebuilt": return `${imports} const old=Error("red"); const t=test.extend({ resource: async ({}, use) => { if(process.env.PHASE_FAIL==="1") throw old; await use(1); } }); t("case",({resource})=>{expect(resource).toBe(1);${body}});`;
    case "fixtureString": return `${imports} const t=test.extend({ resource: async ({}, use) => { if(process.env.PHASE_FAIL==="1") throw "red"; await use(1); } }); t("case",({resource})=>{expect(resource).toBe(1);${body}});`;
    case "fixtureConcurrentPrebuilt": return `${imports} const old=Error("red"); const t=test.concurrent.extend({ resource: async ({}, use) => { if(process.env.PHASE_FAIL==="1") throw old; await use(1); } }); t("case",({resource})=>{expect(resource).toBe(1);${body}});`;
    case "fixtureFilePrebuilt": return `${imports} const old=Error("red"); const t=test.extend({ resource: [async ({}, use) => { if(process.env.PHASE_FAIL==="1") throw old; await use(1); }, { scope: "file" }] }); t("case",({resource})=>{expect(resource).toBe(1);${body}});`;
    case "fixtureConcurrentBody": return `${imports} const t=test.concurrent.extend({ resource: async ({}, use) => { await use(1); } }); t("case",({resource})=>{expect(resource).toBe(1);${body}});`;
    case "fixtureFileBody": return `${imports} const t=test.extend({ resource: [async ({}, use) => { await use(1); }, { scope: "file" }] }); t("case",({resource})=>{expect(resource).toBe(1);${body}});`;
    case "bodyStackMarker": return `${imports} it("case",()=>{if(process.env.BODY_FAIL==="1") throw Error("STACK_TRACE_ERROR"); else expect(1).toBe(1);});`;
    case "busyBodyTimeout": return `${imports} it("case",async()=>{if(process.env.PHASE_FAIL==="1"){const until=Date.now()+60;while(Date.now()<until){} await new Promise(r=>setTimeout(r,0));} ${body}},20);`;
    case "busySyncTimeout": return `${imports} it("case",()=>{if(process.env.PHASE_FAIL==="1"){const until=Date.now()+60;while(Date.now()<until){}} ${body}},20);`;
    case "finishedExpect": return `${imports} it("case", () => { onTestFinished(() => { ${expectFail} }); ${body} });`;
    case "bodyErrorRed": return `${imports} it("case", () => { if(process.env.BODY_FAIL==="1") throw Error("red"); else expect(1).toBe(1); });`;
    case "timeoutLike": return `${imports} it("case", async () => { if (process.env.BODY_FAIL === "1") await expect.poll(() => 1, { timeout: 20 }).toBe(2); else expect(1).toBe(1); });`;
    case "timeoutLiteral": return `${imports} it("case", () => { if (process.env.BODY_FAIL === "1") expect("Test timed out in 20ms").toBe("ok"); else expect(1).toBe(1); });`;
    case "bodyTypeError": return `${imports} it("case", () => { if (process.env.BODY_FAIL === "1") (undefined)(); else expect(1).toBe(1); });`;
    case "bodyReferenceError": return `${imports} it("case", () => { if (process.env.BODY_FAIL === "1") missingIdentifier; else expect(1).toBe(1); });`;
    case "bodyString": return `${imports} it("case", () => { if (process.env.BODY_FAIL === "1") throw "red"; else expect(1).toBe(1); });`;
    case "bodyAsyncReject": return `${imports} it("case", async () => { if (process.env.BODY_FAIL === "1") await Promise.reject(Error("red")); else expect(1).toBe(1); });`;
    case "duplicateForward": case "duplicateReverse": {
      const firstBody = which === "duplicateForward" ? 'expect(1).toBe(2)' : 'expect(1).toBe(1)';
      const secondBody = which === "duplicateForward" ? 'expect(1).toBe(1)' : 'expect(1).toBe(2)';
      const cleanupAt = which === "duplicateForward" ? 2 : 1;
      return `${imports} let n=0; beforeEach(() => { const x=++n; return () => { if(x===${cleanupAt}) throw Error("red"); }; }); it("same",()=>{${firstBody}}); it("same",()=>{${secondBody}});`;
    }
    case "countAssertions": return `${imports} it("case", () => { expect.assertions(1); if (process.env.BODY_FAIL === "0") expect(1).toBe(1); });`;
    case "countHasAssertions": return `${imports} it("case", () => { expect.hasAssertions(); if (process.env.BODY_FAIL === "0") expect(1).toBe(1); });`;
    case "countMessageAfterEach": return `${imports} afterEach(() => { if (process.env.PHASE_FAIL === "1") throw Error("expected number of assertions to be 1, but got 0"); }); it("case", () => { ${body} });`;
    case "countMessageCleanup": return `${imports} beforeEach(() => () => { if (process.env.PHASE_FAIL === "1") throw Error("expected number of assertions to be 1, but got 0"); }); it("case", () => { ${body} });`;
    case "countAndCleanup": return `${imports} beforeEach(() => () => { if (process.env.PHASE_FAIL === "1") throw Error("red"); }); it("case", () => { expect.assertions(1); if (process.env.BODY_FAIL === "0") expect(1).toBe(1); });`;
    case "concurrent": return `${imports} import { writeFileSync, existsSync } from "node:fs"; describe.concurrent("inner",()=>{ beforeEach((ctx)=>async()=>{ if(ctx.task.name==="B"){ while(!existsSync("A-start")) await new Promise(r=>setTimeout(r,1)); writeFileSync("B-cleanup",String(Date.now())); if(process.env.PHASE_FAIL==="1") throw Error("red"); } }); it("A",async()=>{writeFileSync("A-start",String(Date.now())); await new Promise(r=>setTimeout(r,50)); writeFileSync("A-end",String(Date.now())); ${body}}); it("B",()=>{expect(1).toBe(1)}); });`;
    case "retryBodyThenCleanup": return `${imports} import { writeFileSync } from "node:fs"; let n=0; beforeEach(()=>{const x=++n; writeFileSync("attempts",String(n)); return()=>{ if(process.env.PHASE_FAIL==="1"&&x===2) throw Error("red"); };}); it("case",{retry:1},()=>{if(n===1) expect(1).toBe(2); else expect(1).toBe(1);});`;
    case "retryCleanupThenBody": return `${imports} import { writeFileSync } from "node:fs"; let n=0; beforeEach(()=>{const x=++n; writeFileSync("attempts",String(n)); return()=>{ if(process.env.PHASE_FAIL==="1"&&x===1) throw Error("red"); };}); it("case",{retry:1},()=>{if(n===2) expect(1).toBe(2); else expect(1).toBe(1);});`;
    case "repeatCleanupSecond": return `${imports} import { writeFileSync } from "node:fs"; let n=0; beforeEach(()=>{const x=++n; writeFileSync("attempts",String(n)); return()=>{ if(process.env.PHASE_FAIL==="1"&&x===2) throw Error("red"); };}); it("case",{repeats:1},()=>{expect(1).toBe(1);});`;
    case "configTs": return `${imports} it("case", () => { expect(globalThis.__phaseSetup).toBe(true); expect(document).toBeDefined(); ${body} });`;
    case "configTsFail": return sourceFor("configTs");
    case "allPhases": return `${imports} const t=test.extend({ resource: async ({}, use) => { await use(1); if(process.env.PHASE_FAIL==="1") throw Error("red"); } }); describe("inner", () => { beforeAll(() => { if(process.env.PHASE_FAIL==="1") throw Error("red"); }); beforeEach(() => () => { if(process.env.PHASE_FAIL==="1") throw Error("red"); }); afterAll(() => { if(process.env.PHASE_FAIL==="1") throw Error("red"); }); t("case", ({ resource }) => { expect(resource).toBe(1); onTestFinished(() => { if(process.env.PHASE_FAIL==="1") throw Error("red"); }); onTestFailed(() => { if(process.env.PHASE_FAIL==="1") throw Error("red"); }); ${body} }); });`;
    case "allPhasesFail": return sourceFor("allPhases");
    case "allPhasesConfig": return sourceFor("allPhases");
    default: throw Error(`unknown source ${which}`);
  }
}

function runCase() {
  const source = sourceFor(name);
  setup(source, ["configTs", "configTsFail", "allPhasesConfig"].includes(name));
  const positive = ["timeoutLike", "timeoutLiteral", "bodyTypeError", "bodyReferenceError", "bodyString", "bodyAsyncReject", "bodyErrorRed", "bodyStackMarker", "fixtureConcurrentBody", "fixtureFileBody", "countAssertions", "countHasAssertions", "configTs", "allPhases", "allPhasesConfig"].includes(name);
  const alone = name.endsWith("Alone");
  const flags = positive ? { BODY_FAIL: "1", PHASE_FAIL: "0" } : { BODY_FAIL: alone || name === "busySyncTimeout" ? "0" : "1", PHASE_FAIL: "1" };
  const red = invoke("record", flags);
  const green = positive && red.status === 0 ? invoke("verify", { BODY_FAIL: "0", PHASE_FAIL: "0" }) : null;
  const setupReached = ["configTs", "configTsFail", "allPhasesConfig"].includes(name) ? readFileSync(join(root, "setup-reached"), "utf8") : null;
  const overlap = name === "concurrent" ? Number(readFileSync(join(root,"A-start"),"utf8")) <= Number(readFileSync(join(root,"B-cleanup"),"utf8")) && Number(readFileSync(join(root,"B-cleanup"),"utf8")) < Number(readFileSync(join(root,"A-end"),"utf8")) : null;
  const attempts = name.startsWith("retry") || name.startsWith("repeat") ? Number(readFileSync(join(root,"attempts"),"utf8")) : null;
  return { red: { status: red.status, kind: red.kind }, green: green ? { status: green.status, verdict: green.verdict } : null, setupReached, overlap, attempts };
}

try { process.stdout.write(JSON.stringify(runCase())); }
catch (error) { process.stderr.write(String(error.stack || error)); process.exitCode = 1; }
finally { rmSync(root, { recursive: true, force: true }); }
