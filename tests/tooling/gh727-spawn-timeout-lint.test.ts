// @vitest-environment node
/** GH727 AC-4: the spawn-timeout lint in the conditional-tests family (scripts/lint/spawn-timeouts.mjs). */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { runChild } from "../support/loadGuardChild";
import { spawnBudget } from "../support/spawnBudget";
// @ts-expect-error -- plain ESM repository script has no declaration file
import { checkSpawnTimeouts } from "../../scripts/lint/spawn-timeouts.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "gh727-lint-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
let serial = 0;
/** Write `files` (relative to a fresh temp repo) and lint the first one. */
function lint(files: Record<string, string>): string[] {
  const base = path.join(root, `case-${serial++}`);
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(base, name)), { recursive: true });
    fs.writeFileSync(path.join(base, name), text);
  }
  const first = path.join(base, Object.keys(files)[0]);
  return (checkSpawnTimeouts(fs.readFileSync(first, "utf8"), first) as string[]).map((line) => line.replace(`${base}/`, ""));
}
const head = 'import { spawn } from "node:child_process";\nimport { it } from "vitest";\n';

describe("GH727 spawn-timeout lint", () => {
  it("reports a tooling test that spawns without a timeout", () => {
    expect(lint({ "tests/tooling/x.test.ts": `${head}it("spawns", () => { spawn("true"); });\n` }))
      .toEqual(["tests/tooling/x.test.ts:3: spawning test without explicit timeout (give it spawnBudget(<worst alone ms>) or a numeric literal above 5000)"]);
  });

  it("accepts a literal above 5000, a measured spawnBudget, and an options timeout", () => {
    const budget = 'import { spawnBudget } from "../support/spawnBudget";\n';
    expect([
      lint({ "tests/tooling/x.test.ts": `${head}it("a", () => { spawn("true"); }, 20_000);\n` }),
      lint({ "tests/tooling/x.test.ts": `${head}${budget}it("b", () => { spawn("true"); }, spawnBudget(2_400));\n` }),
      lint({ "tests/tooling/x.test.ts": `${head}it("c", { timeout: 20_000 }, () => { spawn("true"); });\n` }),
      lint({ "tests/tooling/x.test.ts": `${head}const T = 20_000;\nit("d", () => { spawn("true"); }, T);\n` }),
    ]).toEqual([[], [], [], []]);
  });

  it("treats 5000 or less, zero, undefined, their consts, and values it cannot resolve as no budget", () => {
    const cases = [
      "it(\"a\", () => { spawn(\"true\"); }, 5_000);",
      "it(\"b\", () => { spawn(\"true\"); }, 0);",
      "it(\"c\", () => { spawn(\"true\"); }, undefined);",
      "const T = undefined;\nit(\"d\", () => { spawn(\"true\"); }, T);",
      "const Z = 0;\nit(\"e\", () => { spawn(\"true\"); }, Z);",
      "it(\"f\", { timeout: 4_000 }, () => { spawn(\"true\"); });",
      "export function make(ms: number) { it(\"g\", () => { spawn(\"true\"); }, ms); }",
      "it(\"h\", () => { spawn(\"true\"); }, Number(process.env.T));",
    ];
    expect(cases.map((body) => lint({ "tests/tooling/x.test.ts": `${head}${body}\n` }).length)).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
  });

  it("accepts a file-level vi.setConfig testTimeout and a describe options timeout", () => {
    const vi = 'import { describe, vi } from "vitest";\n';
    expect([
      lint({ "tests/tooling/x.test.ts": `${head}${vi}vi.setConfig({ testTimeout: 30_000 });\nit("a", () => { spawn("true"); });\n` }),
      lint({ "tests/tooling/x.test.ts": `${head}${vi}describe("d", { timeout: 30_000 }, () => { it("a", () => { spawn("true"); }); });\nit("b", () => { spawn("true"); });\n` }),
    ]).toEqual([[], [`tests/tooling/x.test.ts:5: ${"spawning test without explicit timeout (give it spawnBudget(<worst alone ms>) or a numeric literal above 5000)"}`]]);
  });

  it("does not count a vi.setConfig that runs after collection, or a hookTimeout", () => {
    const vi = 'import { beforeAll, vi } from "vitest";\n';
    expect([
      lint({ "tests/tooling/x.test.ts": `${head}${vi}beforeAll(() => { vi.setConfig({ testTimeout: 30_000 }); });\nit("a", () => { spawn("true"); });\n` }),
      lint({ "tests/tooling/x.test.ts": `${head}${vi}it("a", () => { vi.setConfig({ testTimeout: 30_000 }); });\nit("b", () => { spawn("true"); });\n` }),
      lint({ "tests/tooling/x.test.ts": `${head}${vi}vi.setConfig({ hookTimeout: 30_000 });\nit("a", () => { spawn("true"); });\n` }),
    ].map((found) => found.length)).toEqual([1, 1, 1]);
  });

  it("follows a spawn through local functions, arrow consts and helpers of helpers", () => {
    const body = [
      "function run() { return spawn(\"true\"); }",
      "const viaArrow = () => run();",
      "function deeper() { return viaArrow(); }",
      "const pure = () => 1;",
      "it(\"one\", () => { run(); });",
      "it(\"two\", () => { viaArrow(); });",
      "it(\"three\", () => { deeper(); });",
      "it(\"pure\", () => { pure(); });",
    ].join("\n");
    expect(lint({ "tests/tooling/x.test.ts": `${head}${body}\n` }).map((line) => line.split(":")[1])).toEqual(["7", "8", "9"]);
  });

  it("follows a spawning object assigned in a hook to the tests that use it", () => {
    const body = [
      "import { beforeEach } from \"vitest\";",
      "function createProject() { return { run: () => spawn(\"true\") }; }",
      "let project: ReturnType<typeof createProject>;",
      "beforeEach(() => { project = createProject(); });",
      "it(\"uses it\", () => { project.run(); });",
    ].join("\n");
    expect(lint({ "tests/tooling/x.test.ts": `${head}${body}\n` }).map((line) => line.split(":")[1])).toEqual(["7"]);
  });

  it("recognises every way a test file loads child_process, and not a string that mentions it", () => {
    const it = 'import { it } from "vitest";\n';
    const sources = [
      'import { spawnSync, execFileSync } from "node:child_process";\nit("a", () => { spawnSync("true"); });\nit("b", () => { execFileSync("true"); });',
      'import { execFile } from "node:child_process";\nimport { promisify } from "node:util";\nconst run = promisify(execFile);\nit("a", async () => { await run("true"); });',
      'import * as cp from "node:child_process";\nit("a", () => { cp.spawn("true"); });',
      'import cp from "node:child_process";\nit("a", () => { cp.fork("x"); });',
      'import { exec } from "child_process";\nit("a", () => { exec("true"); });',
      'const { spawn } = require("node:child_process");\nit("a", () => { spawn("true"); });',
      'it("a", async () => { const cp = await import("node:child_process"); cp.spawn("true"); });',
      'import fs from "node:fs";\nit("a", () => { fs.writeFileSync("f.js", `require("child_process").spawn("x")`); });',
    ];
    expect(sources.map((source) => lint({ "tests/tooling/x.test.ts": `${it}${source}\n` }).length)).toEqual([2, 1, 1, 1, 1, 1, 1, 0]);
  });

  it("follows a spawning export through relative imports and re-exports, but not a pure export of the same module", () => {
    const support = 'import { spawnSync } from "node:child_process";\nexport const VERSION = "1";\nexport function runX() { return spawnSync("true"); }\n';
    const test = [
      'import { it } from "vitest";',
      'import { runX, VERSION } from "../support/direct";',
      'import { runX as viaStar } from "../support/star";',
      'import { runX as viaNamed } from "../support/named";',
      'it("direct", () => { runX(); });',
      'it("star", () => { viaStar(); });',
      'it("named", () => { viaNamed(); });',
      'it("pure", () => { expect(VERSION).toBe("1"); });',
    ].join("\n");
    expect(lint({
      "tests/tooling/x.test.ts": `${test}\n`,
      "tests/support/direct.ts": support,
      "tests/support/star.ts": 'export * from "./direct";\n',
      "tests/support/named.ts": 'export { runX } from "./direct";\n',
    }).map((line) => line.split(":")[1])).toEqual(["5", "6", "7"]);
  });

  it("follows a spawn inside an exported object method and an exported class method", () => {
    const test = 'import { it } from "vitest";\nimport { harness, H } from "../support/h";\nit("object", () => { harness.run(); });\nit("class", () => { new H().run(); });\n';
    expect(lint({
      "tests/tooling/x.test.ts": test,
      "tests/support/h.ts": 'import { spawn, spawnSync } from "node:child_process";\nexport const harness = { run() { return spawnSync("true"); } };\nexport class H { run() { spawn("true"); } }\n',
    }).map((line) => line.split(":")[1])).toEqual(["3", "4"]);
  });

  it("scopes a local name to its own function, so a same-named local elsewhere does not reach", () => {
    const test = 'import { it } from "vitest";\nimport { load, cached, outer } from "../support/c";\nit("load", async () => { await load(); });\nit("cached", () => { cached(); });\nit("outer", () => { outer(); });\n';
    expect(lint({
      "tests/tooling/x.test.ts": test,
      "tests/support/c.ts": [
        'import { execFile } from "node:child_process";',
        'const cache = new Map<string, string>();',
        'export async function load() { const list = execFile("git"); cache.set("k", String(list)); }',
        'export function cached() { const list = cache.get("k"); return list; }',
        'let shared: unknown;',
        'export function arm() { shared = execFile("git"); }',
        'export function outer() { return shared; }',
      ].join("\n"),
    }).map((line) => line.split(":")[1])).toEqual(["3", "5"]);
  });

  it("ends on an import cycle and still reports the spawn behind it once", () => {
    const test = 'import { it } from "vitest";\nimport { viaA } from "../support/a";\nit("cycle", () => { viaA(); });\n';
    expect(lint({
      "tests/tooling/x.test.ts": test,
      "tests/support/a.ts": 'import { viaB } from "./b";\nexport function viaA() { return viaB(); }\n',
      "tests/support/b.ts": 'import { spawn } from "node:child_process";\nimport { viaA } from "./a";\nexport function viaB() { return spawn("true"); }\nexport const loop = () => viaA();\n',
    }).map((line) => line.split(":")[1])).toEqual(["3"]);
  });

  it("reads it.each, skipIf, concurrent and describe.skipIf registrations", () => {
    const body = [
      'import { describe, test } from "vitest";',
      'it.each([1, 2])("each %s", () => { spawn("true"); });',
      'it.each([1, 2])("each with budget %s", () => { spawn("true"); }, 20_000);',
      'it.skipIf(process.platform === "win32")("skipIf", () => { spawn("true"); });',
      'test.concurrent("concurrent", async () => { spawn("true"); });',
      'describe.skipIf(false)("suite", () => { it("inner", () => { spawn("true"); }); });',
    ].join("\n");
    expect(lint({ "tests/tooling/x.test.ts": `${head}${body}\n` }).map((line) => line.split(":")[1])).toEqual(["4", "6", "7", "8"]);
  });

  it("applies only to test files under tests/tooling, at any depth", () => {
    const source = `${head}it("spawns", () => { spawn("true"); });\n`;
    expect([
      lint({ "tests/tooling/sub/x.test.ts": source }).length,
      lint({ "tests/x.test.ts": source }).length,
      lint({ "tests/control/x.test.ts": source }).length,
      lint({ "tests/tooling/harness.ts": source }).length,
    ]).toEqual([1, 0, 0, 0]);
  });
});

const cli = path.resolve("scripts/lint/conditional-tests.mjs");
/** A throwaway repo: `files` under its root, the D302 list empty unless given, then a full-scan CLI run. */
async function scan(files: Record<string, string>, signal: AbortSignal) {
  const base = path.join(root, `cli-${serial++}`);
  const all = { "scripts/lint/d302-sync-exceptions.json": "[]\n", ...files };
  for (const [name, text] of Object.entries(all)) {
    fs.mkdirSync(path.dirname(path.join(base, name)), { recursive: true });
    fs.writeFileSync(path.join(base, name), text);
  }
  const result = await runChild("/bin/sh", ["-c", `cd '${base}' && exec '${process.execPath}' '${cli}'`], { signal });
  return { status: result.status, stderr: result.stderr.replaceAll(`${base}/`, "") };
}
const spawningTest = (count: number) => `${head}${Array.from({ length: count }, (_, n) => `it("t${n}", () => { spawn("true"); });`).join("\n")}\n`;
const baseline = (files: Record<string, number>) => ({ "scripts/lint/gh727-spawn-timeout-baseline.json": JSON.stringify({ files }) });

describe("GH727 spawn-timeout baseline (full scan)", () => {
  it("is a ratchet: at its count passes, above fails, below or for a missing file is stale, malformed throws", async ({ signal }) => {
    const at = await scan({ "tests/tooling/x.test.ts": spawningTest(2), ...baseline({ "tests/tooling/x.test.ts": 2 }) }, signal);
    const above = await scan({ "tests/tooling/x.test.ts": spawningTest(3), ...baseline({ "tests/tooling/x.test.ts": 2 }) }, signal);
    const below = await scan({ "tests/tooling/x.test.ts": spawningTest(1), ...baseline({ "tests/tooling/x.test.ts": 2 }) }, signal);
    const missing = await scan({ "tests/tooling/x.test.ts": spawningTest(0), ...baseline({ "tests/tooling/gone.test.ts": 1 }) }, signal);
    const malformed = await scan({ "tests/tooling/x.test.ts": spawningTest(0), "scripts/lint/gh727-spawn-timeout-baseline.json": "{\"files\": {\"a\": -1}}" }, signal);
    expect({
      at: at.status,
      above: [above.status, above.stderr.includes("tests/tooling/x.test.ts: 3 spawning tests without explicit timeout; the GH727 baseline allows 2")],
      below: [below.status, below.stderr.includes("tests/tooling/x.test.ts: stale GH727 spawn-timeout baseline (lists 2, found 1); lower it to 1")],
      missing: [missing.status, missing.stderr.includes("tests/tooling/gone.test.ts: stale GH727 spawn-timeout baseline (lists 1, found 0); remove it")],
      malformed: [malformed.status, malformed.stderr.includes("Malformed GH727 spawn-timeout baseline")],
    }).toEqual({ at: 0, above: [1, true], below: [1, true], missing: [1, true], malformed: [1, true] });
  }, spawnBudget(2_000));

  it("keeps the D302 synchronous-child finding in the same run as a spawn-timeout finding", async ({ signal }) => {
    const sync = `import { execSync } from "node:child_process";\nimport { it } from "vitest";\nit("s", () => { execSync("true"); }, 30_000);\n`;
    const run = await scan({ "tests/tooling/x.test.ts": spawningTest(1), "tests/tooling/sync.test.ts": sync }, signal);
    expect([
      run.status,
      run.stderr.includes("tests/tooling/sync.test.ts:3: synchronous child process"),
      run.stderr.includes("tests/tooling/x.test.ts: 1 spawning tests without explicit timeout; the GH727 baseline allows 0"),
    ]).toEqual([1, true, true]);
  }, spawnBudget(1_000));
});
