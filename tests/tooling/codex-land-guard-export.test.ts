// @vitest-environment node
// D355 code-review fixes (S7, S8): land-guard's export of the candidate and how it starts the rule tests.
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, it } from "vitest";
import { ruleTestCommand, ruleTestSpawn, runRuleTests } from "../../scripts/codex-rules/land-guard.mjs";

const root = path.resolve(__dirname, "../..");
// awaited git (D302: no synchronous child process in a test worker; D355 fix 3)
const runFile = promisify(execFile);
const made: string[] = [];
afterEach(() => { for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

it("S7: the export's index lists every file of the commit, including tracked files an ignore rule matches", { timeout: 60_000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "d355-export-"));
  made.push(dir);
  const stub = path.join(dir, "ls-files"), out = path.join(dir, "ls-files.out");
  fs.writeFileSync(stub, `#!/bin/sh\ngit ls-files -z > "$LS_OUT"\n`);
  fs.chmodSync(stub, 0o755);
  const result = runRuleTests("HEAD", {
    PATH: process.env.PATH, HOME: process.env.HOME, MDPRO_GUARD_TEST: "1", MDPRO_GUARD_RULE_TEST_RUNNER: stub, LS_OUT: out,
  });
  expect(result.status, result.output).toBe(0);
  const exported = fs.readFileSync(out, "utf8").split("\0").filter(Boolean).sort();
  const committed = (await runFile("git", ["ls-tree", "-r", "-z", "--name-only", "HEAD"], { cwd: root, maxBuffer: 64 << 20, encoding: "utf8" }))
    .stdout.split("\0").filter(Boolean).sort();
  const ignoredTracked = (await runFile("git", ["ls-files", "-ci", "--exclude-standard", "-z"], { cwd: root, maxBuffer: 64 << 20, encoding: "utf8" }))
    .stdout.split("\0").filter(Boolean);
  expect(ignoredTracked.length).toBeGreaterThan(0);
  expect(ignoredTracked.filter((name) => !exported.includes(name))).toEqual([]);
  expect(exported.filter((name) => !committed.includes(name))).toEqual([]);
  expect(committed.filter((name) => !exported.includes(name))).toEqual([]);
});

it("S8: the real rule-test run goes through the heavy-lock load guard; the test-mode stub runs as given", () => {
  const [node, args] = ruleTestCommand({});
  expect(ruleTestSpawn({})).toEqual([path.join(root, "scripts/heavy-lock.sh"), ["--guard-only", node, ...args]]);
  const stubEnv = { MDPRO_GUARD_TEST: "1", MDPRO_GUARD_RULE_TEST_RUNNER: "/tmp/stub" };
  expect(ruleTestSpawn(stubEnv)).toEqual(ruleTestCommand(stubEnv));
});
