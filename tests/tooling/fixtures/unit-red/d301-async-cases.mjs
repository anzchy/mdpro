import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const [scenario, variant, repo] = process.argv.slice(2);
const root = mkdtempSync(join(tmpdir(), "mdpro-d301-"));
const entry = join(repo, "scripts/tdd/red-receipt.mjs");
const imports = 'import { test, it, expect, beforeAll, beforeEach, afterEach, afterAll } from "vitest";';
const deferred = 'let release; const pending = new Promise(resolve => { release = resolve; });';
const body = 'release(1); if (process.env.BODY_FAIL === "1") expect(1).toBe(2); else expect(1).toBe(1);';

function sourceFor() {
  const expected = 'process.env.PHASE_FAIL === "1" ? 2 : 1';
  switch (scenario) {
    case "fixture": return `${imports} ${deferred} const t = test.extend({ resource: async ({}, use) => { expect(pending).resolves.toBe(${expected}); await use(1); } }); t("case", ({ resource }) => { expect(resource).toBe(1); ${body} });`;
    case "beforeEach": return `${imports} ${deferred} beforeEach(() => { expect(pending).resolves.toBe(${expected}); }); it("case", () => { ${body} });`;
    case "beforeAll": return `${imports} beforeAll(() => { expect(Promise.resolve(1)).resolves.toBe(${expected}); }); it("case", () => { if (process.env.BODY_FAIL === "1") expect(1).toBe(2); else expect(1).toBe(1); });`;
    case "afterEachRejects": return `${imports} afterEach(() => { expect(Promise.resolve(1)).rejects.toThrow("expected"); }); it("case", () => { if (process.env.BODY_FAIL === "1") expect(1).toBe(2); else expect(1).toBe(1); });`;
    case "afterAllRejects": return `${imports} afterAll(() => { expect(Promise.resolve(1)).rejects.toThrow("expected"); }); it("case", () => { if (process.env.BODY_FAIL === "1") expect(1).toBe(2); else expect(1).toBe(1); });`;
    case "fixtureAwaited": return `${imports} const t = test.extend({ resource: async ({}, use) => { await expect(Promise.resolve(1)).resolves.toBe(1); await use(1); } }); t("case", ({ resource }) => { expect(resource).toBe(1); if (process.env.BODY_FAIL === "1") expect(1).toBe(2); });`;
    case "beforeEachAwaited": return `${imports} beforeEach(async () => { await expect(Promise.resolve(1)).resolves.toBe(1); }); it("case", () => { if (process.env.BODY_FAIL === "1") expect(1).toBe(2); });`;
    case "twoOrigins": return `${imports} ${deferred} beforeEach(() => { expect(pending).resolves.toBe(2); }); it("case", async () => { const q = Promise.resolve(1); if (process.env.ORDER === "P_FIRST") release(1); await expect(q).resolves.toBe(1); if (process.env.ORDER !== "P_FIRST") release(1); expect(1).toBe(1); });`;
    case "bodyHard": return `${imports} it("case", () => { expect(Promise.resolve(1)).resolves.toBe(2); });`;
    case "bodyAwaited": return `${imports} it("case", async () => { await expect(Promise.resolve(1)).resolves.toBe(2); });`;
    case "bodyAwaitedPass": return `${imports} it("case", async () => { await expect(Promise.resolve(1)).resolves.toBe(1); });`;
    case "bodyRejectsAwaited": return `${imports} it("case", async () => { await expect(Promise.reject(Error("actual"))).rejects.toThrow("other"); });`;
    case "passingBodyHard": return `${imports} it("case", () => { expect(Promise.resolve(1)).resolves.toBe(1); expect(1).toBe(1); });`;
    case "passingBodySoft": return `${imports} it("case", () => { expect.soft(Promise.resolve(1)).resolves.toBe(1); expect(1).toBe(1); });`;
    case "passingSetup": return `${imports} beforeEach(async () => { await expect(Promise.resolve(1)).resolves.toBe(1); }); it("case", () => { expect(1).toBe(2); });`;
    case "passingSetupUnawaited": return `${imports} beforeEach(() => { expect(Promise.resolve(1)).resolves.toBe(1); }); it("case", () => { expect(1).toBe(2); });`;
    case "retrySetupFirst": return `${imports} let n = 0; beforeEach(() => { n++; if (n === 1) { expect.soft(1).toBe(2); expect(Promise.resolve(1)).resolves.toBe(2); } }); it("case", { retry: 1 }, () => { if (n === 2) expect(1).toBe(2); else expect(1).toBe(1); });`;
    case "retrySetupLast": return `${imports} let n = 0; beforeEach(() => { n++; if (n === 2) expect(Promise.resolve(1)).resolves.toBe(2); }); it("case", { retry: 1 }, () => { if (n === 1) expect(1).toBe(2); else expect(1).toBe(1); });`;
    case "repeatSetupLast": return `${imports} let n = 0; beforeEach(() => { n++; if (n === 2) expect(Promise.resolve(1)).resolves.toBe(2); }); it("case", { repeats: 1 }, () => { if (n === 1) expect(1).toBe(2); else expect(1).toBe(1); });`;
    case "retryAwaited": return `${imports} let n = 0; beforeEach(async () => { n++; await expect(Promise.resolve(1)).resolves.toBe(1); }); it("case", { retry: 1 }, () => { expect(1).toBe(2); });`;
    case "repeatAwaited": return `${imports} beforeEach(async () => { await expect(Promise.resolve(1)).resolves.toBe(1); }); it("case", { repeats: 1 }, () => { expect(1).toBe(2); });`;
    case "concurrent": return `${imports} ${deferred} let signalB; const bReady = new Promise(resolve => { signalB = resolve; }); const t = test.extend({ resource: async ({}, use) => { ${variant === "awaited" ? "release(1); await " : ""}expect(pending).resolves.toBe(${variant === "awaited" ? 1 : 2}); signalB(); await use(1); } }); test.concurrent("A", async () => { await bReady; ${variant === "awaited" ? "" : "release(1);"} expect(1).toBe(2); }); t.concurrent("B", ({ resource }) => { expect(resource).toBe(1); });`;
    case "twoTests": {
      const awaited = variant.toLowerCase().includes("awaited");
      const x = `it("X", ${awaited ? "async " : ""}() => { ${awaited ? "await " : ""}expect(Promise.resolve(1)).resolves.toBe(1); });`;
      const y = 'it("Y", () => { expect(1).toBe(2); });';
      return `${imports} ${variant.startsWith("yFirst") ? `${y} ${x}` : `${x} ${y}`}`;
    }
    default: throw Error(`Unknown scenario ${scenario}`);
  }
}

function git(args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.status) throw Error(result.stderr);
}

function setup() {
  mkdirSync(join(root, "tests"));
  mkdirSync(join(root, "scripts/tdd"), { recursive: true });
  mkdirSync(join(root, ".claude/tdd-guardian"), { recursive: true });
  symlinkSync(join(repo, "node_modules"), join(root, "node_modules"));
  symlinkSync(join(repo, "scripts/tdd/unit-red-lane.mjs"), join(root, "scripts/tdd/unit-red-lane.mjs"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ type: "module" }));
  writeFileSync(join(root, "vitest.config.mjs"), 'export default { test: { include: ["tests/**/*.test.ts"], maxWorkers: 2 } };\n');
  writeFileSync(join(root, ".claude/tdd-guardian/config.json"), readFileSync(join(repo, ".claude/tdd-guardian/config.json")));
  writeFileSync(join(root, ".claude/tdd-guardian/receipts.json"), JSON.stringify({ schemaVersion: 2, receipts: [] }));
  git(["init", "-q", "-b", "master"]);
  git(["config", "user.email", "test@example.com"]);
  git(["config", "user.name", "Test"]);
  git(["add", "package.json", "vitest.config.mjs", ".claude/tdd-guardian/config.json", ".claude/tdd-guardian/receipts.json", "scripts/tdd/unit-red-lane.mjs"]);
  git(["commit", "-qm", "fixture"]);
  git(["switch", "-qc", "feature"]);
  writeFileSync(join(root, "tests/case.test.ts"), sourceFor());
}

function invoke(action, flags) {
  const env = { ...process.env, PHASE_FAIL: "0", BODY_FAIL: "0", ORDER: "Q_FIRST", ...flags };
  for (const key of ["MDPRO_UNIT_RED_FILES", "MDPRO_UNIT_RED_MARKER", "MDPRO_UNIT_RED_NONCE", "MDPRO_UNIT_RED_FLOCK_FD"]) delete env[key];
  const args = action === "record" ? [entry, "record", "--id", "D301CASE", "--test", "tests/case.test.ts", "--cwd", root]
    : [entry, "verify", "--id", "D301CASE", "--cwd", root];
  const run = spawnSync(process.execPath, args, { cwd: root, env, encoding: "utf8", timeout: 60_000 });
  const stored = JSON.parse(readFileSync(join(root, ".claude/tdd-guardian/receipts.json"), "utf8")).receipts[0];
  return { status: run.status, kind: stored?.red.kind || null, verdict: stored?.verdict || null, output: `${run.stdout || ""}\n${run.stderr || ""}` };
}

try {
  setup();
  const flags = variant === "mixed" ? { PHASE_FAIL: "1", BODY_FAIL: "1" } : variant === "alone" ? { PHASE_FAIL: "1" } : variant === "twin" ? { BODY_FAIL: "1" } : {};
  if (variant === "pFirst") flags.ORDER = "P_FIRST";
  const red = invoke("record", flags);
  const green = variant === "twin" && red.status === 0 ? invoke("verify", { PHASE_FAIL: "0", BODY_FAIL: "0" }) : null;
  process.stdout.write(JSON.stringify({ red, green, phaseRan: existsSync(join(root, "phase-ran")) }));
} catch (error) {
  process.stderr.write(String(error.stack || error));
  process.exitCode = 1;
} finally {
  rmSync(root, { recursive: true, force: true });
}
