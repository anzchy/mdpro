import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

const [phase, variant, repo] = process.argv.slice(2);
const root = mkdtempSync(join(tmpdir(), "mdpro-d301-fix1-"));
const entry = join(repo, "scripts/tdd/red-receipt.mjs");

function sourceFor() {
  const waitMarker = `function waitMarker(name) { return new Promise(done => {
    if (readFileSync(name, "utf8") === "yes") return done();
    const watcher = watch(name, () => { if (readFileSync(name, "utf8") === "yes") { watcher.close(); done(); } });
    if (readFileSync(name, "utf8") === "yes") { watcher.close(); done(); }
  }); }`;
  const makeAssertion = `expectA(pending).resolves.toBe(process.env.PHASE_FAIL === "1" ? 2 : 1); writeFileSync("late-registered", "yes");`;
  const schedule = phase === "finish"
    ? `onTestFinished(() => { ${makeAssertion} });`
    : phase === "timer"
      ? `setTimeout(async () => { await waitMarker("A-delivered"); ${makeAssertion} }, 0);`
      : (() => { throw Error(`Unknown phase ${phase}`); })();
  return `import { it, expect, onTestFinished } from "vitest";
    import { readFileSync, watch, writeFileSync } from "node:fs";
    ${waitMarker}
    let release; const pending = new Promise(resolve => { release = resolve; });
    it("A", context => { const expectA = context.expect; ${schedule} expect(1).toBe(1); });
    it("B", async () => {
      await waitMarker("A-delivered");
      writeFileSync("B-saw-A", "yes");
      await waitMarker("late-registered");
      writeFileSync("B-saw-late", "yes");
      release(1);
      writeFileSync("B-released", "yes");
      await pending;
      await new Promise(setImmediate);
      expect(1).toBe(process.env.BODY_FAIL === "1" ? 2 : 1);
    });`;
}

function git(args) {
  const run = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (run.status !== 0) throw Error(run.stderr);
}

function setup() {
  mkdirSync(join(root, "tests"));
  mkdirSync(join(root, "scripts/tdd"), { recursive: true });
  mkdirSync(join(root, ".claude/tdd-guardian"), { recursive: true });
  symlinkSync(join(repo, "node_modules"), join(root, "node_modules"));
  symlinkSync(join(repo, "scripts/tdd/unit-red-lane.mjs"), join(root, "scripts/tdd/unit-red-lane.mjs"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ type: "module" }));
  const config = `import base from ${JSON.stringify(join(repo, "vitest.config.ts"))};
    import { writeFileSync } from "node:fs";
    export default {
      ...base,
      server: { fs: { allow: [process.cwd(), ${JSON.stringify(repo)}, ${JSON.stringify(dirname(dirname(join(repo, "tests/setup.ts"))))}] } },
      plugins: [...(base.plugins || []), { name: "d301-delivery-barrier", configureVitest({ vitest }) {
        const report = vitest.report.bind(vitest);
        vitest.report = async function(name, ...args) {
          const result = await report(name, ...args);
          if (name === "onTestCaseResult" && args[0]?.name === "A") writeFileSync("A-delivered", "yes");
          return result;
        };
      } }],
      test: { ...base.test, testTimeout: 20_000, setupFiles: [${JSON.stringify(join(repo, "tests/setup.ts"))}] },
    };`;
  writeFileSync(join(root, "vitest.config.mjs"), config);
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
  for (const marker of ["A-delivered", "late-registered"]) {
    writeFileSync(join(root, marker), "pending");
  }
  const env = { ...process.env, PHASE_FAIL: "0", BODY_FAIL: "0", ...flags };
  for (const key of ["MDPRO_UNIT_RED_FILES", "MDPRO_UNIT_RED_MARKER", "MDPRO_UNIT_RED_NONCE", "MDPRO_UNIT_RED_FLOCK_FD"]) delete env[key];
  const args = action === "record" ? [entry, "record", "--id", "D301FIX1", "--test", "tests/case.test.ts", "--cwd", root]
    : [entry, "verify", "--id", "D301FIX1", "--cwd", root];
  const run = spawnSync(process.execPath, args, { cwd: root, env, encoding: "utf8", timeout: 90_000 });
  const stored = JSON.parse(readFileSync(join(root, ".claude/tdd-guardian/receipts.json"), "utf8")).receipts[0];
  const output = `${run.stdout || ""}\n${run.stderr || ""}`;
  const logPath = output.match(/\[red-receipt\] log: ([^\n]+)/)?.[1];
  return { status: run.status, kind: stored?.red.kind || null, verdict: stored?.verdict || null, output,
    vitestLog: logPath && existsSync(logPath) ? readFileSync(logPath, "utf8") : "" };
}

try {
  setup();
  const red = invoke("record", variant === "failing" ? { PHASE_FAIL: "1", BODY_FAIL: "1" } : { BODY_FAIL: "1" });
  const green = variant === "passing" && red.status === 0 ? invoke("verify", { PHASE_FAIL: "0", BODY_FAIL: "0" }) : null;
  process.stdout.write(JSON.stringify({ red, green, delivered: readFileSync(join(root, "A-delivered"), "utf8") === "yes", registered: readFileSync(join(root, "late-registered"), "utf8") === "yes", bSawA: existsSync(join(root, "B-saw-A")), bSawLate: existsSync(join(root, "B-saw-late")), bReleased: existsSync(join(root, "B-released")) }));
} catch (error) {
  process.stderr.write(String(error.stack || error));
  process.exitCode = 1;
} finally {
  rmSync(root, { recursive: true, force: true });
}
