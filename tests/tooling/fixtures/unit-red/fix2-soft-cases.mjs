import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const [phase, variant, repo] = process.argv.slice(2);
const root = mkdtempSync(join(tmpdir(), "mdpro-soft-phase-"));
const entry = join(repo, "scripts/tdd/red-receipt.mjs");
const imports = 'import { test, it, expect, beforeAll, beforeEach, afterEach, afterAll, onTestFinished, onTestFailed } from "vitest"; import { writeFileSync } from "node:fs";';
const body = 'if (process.env.BODY_FAIL === "1") expect(1).toBe(2); else expect(1).toBe(1);';
const phaseSoft = 'writeFileSync("phase-ran", "yes"); if (process.env.PHASE_FAIL === "1") expect.soft(1).toBe(2); else expect.soft(1).toBe(1);';

function sourceFor(name) {
  const testBody = `it("case", () => { ${body} });`;
  switch (name) {
    case "beforeAll": return `${imports} beforeAll(() => { ${phaseSoft} }); ${testBody}`;
    case "beforeAllCleanup": return `${imports} beforeAll(() => () => { ${phaseSoft} }); ${testBody}`;
    case "beforeEach": return `${imports} beforeEach(() => { ${phaseSoft} }); ${testBody}`;
    case "beforeEachCleanup": return `${imports} beforeEach(() => () => { ${phaseSoft} }); ${testBody}`;
    case "fixtureSetup": return `${imports} const t = test.extend({ resource: async ({}, use) => { ${phaseSoft} await use(1); } }); t("case", ({ resource }) => { expect(resource).toBe(1); ${body} });`;
    case "fixtureTeardown": return `${imports} const t = test.extend({ resource: async ({}, use) => { await use(1); ${phaseSoft} } }); t("case", ({ resource }) => { expect(resource).toBe(1); ${body} });`;
    case "fixtureDelayedSoft": return `${imports} let release; const pending = new Promise(r => { release = r; }); const t = test.extend({ resource: async ({}, use) => { writeFileSync("phase-ran", "yes"); if (process.env.PHASE_FAIL === "1") expect.soft(pending).resolves.toBe(2); else expect.soft(pending).resolves.toBe(1); await use(1); } }); t("case", ({ resource }) => { release(1); expect(resource).toBe(1); ${body} });`;
    case "bodyDelayedSoft": return `${imports} it("case", () => { writeFileSync("phase-ran", "yes"); const pending = Promise.resolve(1); if (process.env.BODY_FAIL === "1") expect.soft(pending).resolves.toBe(2); else expect.soft(pending).resolves.toBe(1); });`;
    case "afterEach": return `${imports} afterEach(() => { ${phaseSoft} }); ${testBody}`;
    case "afterAll": return `${imports} afterAll(() => { ${phaseSoft} }); ${testBody}`;
    case "onFinished": return `${imports} it("case", () => { onTestFinished(() => { ${phaseSoft} }); ${body} });`;
    case "onFailed": return `${imports} afterEach(() => { if (process.env.TRIGGER_FAIL === "1") expect.soft(1).toBe(2); }); it("case", () => { onTestFailed(() => { ${phaseSoft} }); ${body} });`;
    case "retryBeforeEachSoft": return `${imports} let n = 0; beforeEach(() => { n++; writeFileSync("attempts", String(n)); if (n === 1) { ${phaseSoft} } }); it("case", { retry: 1 }, () => { if (n === 2) expect(1).toBe(2); else expect(1).toBe(1); });`;
    default: throw Error(`Unknown phase ${name}`);
  }
}

function git(args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.status) throw Error(result.stderr);
}

function setup() {
  mkdirSync(join(root, "tests")); mkdirSync(join(root, "scripts/tdd"), { recursive: true });
  mkdirSync(join(root, ".claude/tdd-guardian"), { recursive: true });
  symlinkSync(join(repo, "node_modules"), join(root, "node_modules"));
  symlinkSync(join(repo, "scripts/tdd/unit-red-lane.mjs"), join(root, "scripts/tdd/unit-red-lane.mjs"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ type: "module" }));
  writeFileSync(join(root, "vitest.config.mjs"), 'export default { test: { include: ["tests/**/*.test.ts"], maxWorkers: 2 } };\n');
  writeFileSync(join(root, ".claude/tdd-guardian/config.json"), readFileSync(join(repo, ".claude/tdd-guardian/config.json")));
  writeFileSync(join(root, ".claude/tdd-guardian/receipts.json"), JSON.stringify({ schemaVersion: 2, receipts: [] }));
  git(["init", "-q", "-b", "master"]); git(["config", "user.email", "test@example.com"]); git(["config", "user.name", "Test"]);
  git(["add", "package.json", "vitest.config.mjs", ".claude/tdd-guardian/config.json", ".claude/tdd-guardian/receipts.json", "scripts/tdd/unit-red-lane.mjs"]);
  git(["commit", "-qm", "fixture"]); git(["switch", "-qc", "feature"]);
  writeFileSync(join(root, "tests/case.test.ts"), sourceFor(phase));
}

function invoke(action, flags) {
  const env = { ...process.env, PHASE_FAIL: "0", BODY_FAIL: "0", TRIGGER_FAIL: "0", ...flags };
  delete env.MDPRO_UNIT_RED_FILES; delete env.MDPRO_UNIT_RED_MARKER; delete env.MDPRO_UNIT_RED_NONCE; delete env.MDPRO_UNIT_RED_FLOCK_FD;
  const args = action === "record" ? [entry, "record", "--id", "SOFT", "--test", "tests/case.test.ts", "--cwd", root]
    : [entry, "verify", "--id", "SOFT", "--cwd", root];
  const run = spawnSync(process.execPath, args, { cwd: root, env, encoding: "utf8", timeout: 60_000 });
  const stored = JSON.parse(readFileSync(join(root, ".claude/tdd-guardian/receipts.json"), "utf8")).receipts[0];
  return { status: run.status, kind: stored?.red.kind || null, verdict: stored?.verdict || null, output: `${run.stdout || ""}\n${run.stderr || ""}` };
}

function runCase() {
  setup();
  const positive = variant === "twin";
  const flags = positive ? { PHASE_FAIL: "0", BODY_FAIL: "1" } : variant === "mixed"
    ? { PHASE_FAIL: "1", BODY_FAIL: "1" } : { PHASE_FAIL: "1", BODY_FAIL: "0", TRIGGER_FAIL: phase === "onFailed" ? "1" : "0" };
  const red = invoke("record", flags);
  const green = positive && red.status === 0 ? invoke("verify", { PHASE_FAIL: "0", BODY_FAIL: "0" }) : null;
  return {
    red: { status: red.status, kind: red.kind, output: red.output },
    green: green ? { status: green.status, verdict: green.verdict } : null,
    phaseRan: existsSync(join(root, "phase-ran")),
    attempts: existsSync(join(root, "attempts")) ? Number(readFileSync(join(root, "attempts"), "utf8")) : null,
  };
}

try { process.stdout.write(JSON.stringify(runCase())); }
catch (error) { process.stderr.write(String(error.stack || error)); process.exitCode = 1; }
finally { rmSync(root, { recursive: true, force: true }); }
