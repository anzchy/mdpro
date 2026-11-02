// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createOwnerChildRunner } from "./d302Child";
import { createRequire } from "node:module";
import { receiptSuites, vendorDir } from "../support/t566Engine";

const repo = resolve(import.meta.dirname, "../..");
const entry = join(repo, "scripts/tdd/red-receipt.mjs");
const guardian = join(vendorDir, "receipt.js");
const require = createRequire(import.meta.url);
const guardianExec = receiptSuites ? require(join(vendorDir, "lib/exec.js")) : null;
const classifyRedRun = receiptSuites ? require(join(vendorDir, "lib/verification.js")).classifyRedRun : null;
let root: string;
let owner: ReturnType<typeof createOwnerChildRunner> | null = null;

async function run(command: string, args: string[], env: Record<string, string> = {}) {
  const result = await (owner?.run(command, args, { cwd: root, env: { ...process.env, ...env }, timeout: 60_000 }) ?? Promise.reject(Error("D302 owner closed")));
  return { status: result.status, output: `${result.stdout || ""}\n${result.stderr || ""}` };
}

async function command(...args: string[]) {
  return (await run(process.execPath, [entry, ...args, "--cwd", root]));
}

// RC5: receipts are one file per id under receipts/, read here in id order; receipts.json is the engine's view.
const items = () => join(root, ".claude/tdd-guardian/receipts");
const item = (id: string) => join(items(), `${id}.json`);
const view = () => join(root, ".claude/tdd-guardian/receipts.json");
/** Every item file's bytes and the view's, to prove an operation wrote nothing. */
function bytes() {
  const names = existsSync(items()) ? readdirSync(items()).sort() : [];
  return JSON.stringify([names.map((name) => [name, readFileSync(join(items(), name), "utf8")]), existsSync(view()) ? readFileSync(view(), "utf8") : null]);
}
function store() {
  const names = existsSync(items()) ? readdirSync(items()).sort() : [];
  return names.map((name) => JSON.parse(readFileSync(join(items(), name), "utf8"))) as Array<{
    id: string; lane: string; verdict?: string; red: { kind: string; testCounts?: { failed: number } }; test_files: Record<string, unknown>
    dirty_source?: string[];
  }>;
}

function fixture(name: string, source: string) {
  const file = `tests/${name}.test.ts`;
  writeFileSync(join(root, file), source);
  return file;
}

beforeEach(async (context) => {
  owner = createOwnerChildRunner(context.signal);
  root = mkdtempSync(join(tmpdir(), "mdpro-unit-red-"));
  mkdirSync(join(root, "tests"));
  mkdirSync(join(root, ".claude/tdd-guardian"), { recursive: true });
  mkdirSync(join(root, "scripts/tdd"), { recursive: true });
  symlinkSync(join(repo, "node_modules"), join(root, "node_modules"));
  symlinkSync(join(repo, "scripts/tdd/unit-red-lane.mjs"), join(root, "scripts/tdd/unit-red-lane.mjs"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ type: "module", scripts: {} }));
  writeFileSync(join(root, "vitest.config.mjs"), 'export default { test: { include: ["tests/**/*.test.ts"], maxWorkers: 2 } };\n');
  const config = JSON.parse(readFileSync(join(repo, ".claude/tdd-guardian/config.json"), "utf8"));
  config.lanes = config.lanes.filter((lane: { name: string }) => lane.name !== "unit-red");
  config.lanes.push({ name: "unit-red", command: "node scripts/tdd/unit-red-lane.mjs", gateOn: ["manual"], coverage: "none", timeoutMs: 60000 });
  writeFileSync(join(root, ".claude/tdd-guardian/config.json"), JSON.stringify(config));
  (await run("git", ["init", "-q", "-b", "master"]));
  (await run("git", ["config", "user.email", "test@example.com"]));
  (await run("git", ["config", "user.name", "Test"]));
  (await run("git", ["add", "."]));
  (await run("git", ["commit", "-qm", "fixture"]));
  (await run("git", ["switch", "-qc", "feature"]));
});

import { vi } from "vitest";
vi.setConfig({ testTimeout: 180_000 });

afterEach(async () => {
  await owner?.close();
  rmSync(root, { recursive: true, force: true }); owner = null;
});

describe.skipIf(!receiptSuites)("red-receipt entry", () => {
  it("rejects invalid file selections before running or storing", async () => {
    const good = fixture("good", 'import { it } from "vitest"; it("fails", () => { throw Error("red"); });');
    mkdirSync(join(root, "tests/directory"));
    const invalid = [[], [" "], ["tests/directory"], ["tests/*.test.ts"], ["--bad"], ["src/a.test.ts"], ["tests/a.slow.test.ts"], ["tests/typo.test.ts"], [good, "tests/missing.test.ts"]];
    for (const files of invalid) {
      const result = (await command("record", "--id", "A", ...files.flatMap((file) => ["--test", file])));
      expect(result.status).toBe(64);
      expect(store()).toHaveLength(0);
    }
    const spellings = ["./tests/good.test.ts", "tests//good.test.ts", "tests/./good.test.ts", "tests\\good.test.ts", "tests/good.test.ts/", "tests/GOOD.test.ts", "tests-x/a.test.ts", "testsx/a.test.ts", "Tests/a.test.ts", "tests/a\nb.test.ts", "tests/setup.ts", "tests/x.perf.ts"];
    writeFileSync(join(root, "tests/setup.ts"), "");
    for (const file of spellings) {
      const before = bytes();
      expect((await command("record", "--id", "A", "--test", file)).status, file).toBe(64);
      expect(bytes()).toBe(before);
    }
    for (const args of [["record", "--test", good], ["record", "--id", "a b", "--test", good], ["record", "--id", "../x", "--test", good], ["record", "--id", "A", "--lane", "unit", "--test", good], ["record", "--id", "A", "--files", good]]) {
      expect((await command(...args)).status, args.join(" ")).toBe(64);
    }
    symlinkSync("good.test.ts", join(root, "tests/l.test.ts"));
    expect((await command("record", "--id", "A", "--test", "tests/l.test.ts")).status).toBe(64);
  });
  it("requires an id and the recorded selector for verify", async () => {
    const a = fixture("a", 'import { it } from "vitest"; it("a", () => { throw Error("red"); });');
    const b = fixture("b", 'import { it } from "vitest"; it("b", () => { throw Error("red"); });');
    expect((await command("verify")).status).toBe(64);
    expect((await command("record", "--id", "A", "--test", a, "--test", b)).status).toBe(0);
    expect((await command("verify", "--id", "B", "--test", a)).status).toBe(64);
    expect((await command("verify", "--id", "A", "--test", a)).status).toBe(64);
    expect(Object.keys(store()[0].test_files).sort()).toEqual([a, b]);
    expect((await command("verify", "--id", "A")).status).not.toBe(0);
  });
  it("accepts a counted assertion failure and settles only the named receipt", async () => {
    const a = fixture("a", 'import { it, expect } from "vitest"; import { readFileSync } from "node:fs"; it("a", () => { expect(readFileSync(new URL("./state.txt", import.meta.url), "utf8")).toBe("green"); });');
    writeFileSync(join(root, "tests/state.txt"), "red");
    const b = fixture("b", 'import { it } from "vitest"; it("b", () => { throw Error("red"); });');
    expect((await command("record", "--id", "A", "--test", a)).status).toBe(0);
    expect((await command("record", "--id", "B", "--test", b)).status).toBe(0);
    expect(store().map((r) => r.red.kind)).toEqual(["assertion-failure", "assertion-failure"]);
    writeFileSync(join(root, "tests/state.txt"), "green");
    const verified = (await command("verify", "--id", "A"));
    expect(verified.status).toBe(0);
    expect(store().map((r) => [r.id, r.verdict]).sort((left, right) => String(left[0]).localeCompare(String(right[0])))).toEqual([["A", "SEPARATION-HELD"], ["B", null]]);
  });

  it("rejects invalid runs and bare lane execution", async () => {
    const empty = fixture("empty", 'import { it } from "vitest";');
    const skipped = fixture("skipped", 'import { it } from "vitest"; it.skip("skip", () => {});');
    const setup = fixture("setup", 'throw Error("setup broke");');
    for (const [id, file] of [["E", empty], ["S", skipped], ["U", setup]]) {
      expect((await command("record", "--id", id, "--test", file)).status).toBe(64);
      expect(store().find((r) => r.id === id)?.red.kind).not.toBe("assertion-failure");
    }
    const bare = (await run(process.execPath, [join(repo, "scripts/tdd/unit-red-lane.mjs")]));
    expect(bare.status).toBe(64);
    expect(bare.output).toContain("red-receipt.mjs");
  });

  it("rejects an opaque RED before verification can settle it", async () => {
    const file = fixture("a", 'import { it } from "vitest"; it("a", () => {});');
    const configPath = join(root, ".claude/tdd-guardian/config.json");
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    config.lanes.find((lane: { name: string }) => lane.name === "unit-red").command = "sh -c 'echo failure; exit 1'";
    writeFileSync(configPath, JSON.stringify(config));
    expect((await command("record", "--id", "A", "--test", file)).status).not.toBe(0);
    expect(store()[0].red.kind).toBe("opaque-failure");
    config.lanes.find((lane: { name: string }) => lane.name === "unit-red").command = "sh -c 'exit 0'";
    writeFileSync(configPath, JSON.stringify(config));
    expect((await command("verify", "--id", "A")).status).toBe(64);
    expect(store()[0].verdict).toBeNull();
  });

  it("discards only an unsettled receipt on this branch", async () => {
    const a = fixture("a", 'import { it } from "vitest"; it("a", () => { throw Error("red"); });');
    expect((await command("record", "--id", "A", "--test", a)).status).toBe(0);
    expect((await command("discard", "--id", "A")).status).toBe(0);
    expect(store()).toHaveLength(0);
  });

  it("prints one canonical counted line for failing assertions", async () => {
    const cases = [
      'it("fail", () => { throw Error("red"); });',
      'it("fail", () => { throw Error("red"); }); it.skip("skip", () => {});',
      'it("fail", () => { throw Error("red"); }); it("pass", () => {}); it.todo("later");',
    ];
    for (const ansi of [false, true]) {
      for (const [index, source] of cases.entries()) {
        const file = fixture(`count${index}${ansi}`, `import { it } from "vitest"; ${ansi ? 'process.stdout.write("\\x1b[31mTests 999 passed (999)\\x1b[0m");' : 'process.stdout.write("Tests 999 passed (999)");'} ${source}`);
        const result = (await command("record", "--id", `C${index}${ansi}`, "--test", file));
        expect(result.status).toBe(0);
        expect(store().find((r) => r.id === `C${index}${ansi}`)?.red.kind).toBe("assertion-failure");
      }
    }
    const file = "tests/count0false.test.ts";
    const marker = join(root, "marker.json");
    writeFileSync(marker, JSON.stringify({ nonce: "test-nonce", files: [file] }));
    const child = (await run(process.execPath, [join(repo, "scripts/tdd/unit-red-lane.mjs")], { MDPRO_UNIT_RED_FILES: JSON.stringify([file]), MDPRO_UNIT_RED_MARKER: marker, MDPRO_UNIT_RED_NONCE: "test-nonce" }));
    expect(child.status).toBe(1);
    expect(child.output).toMatch(/Tests\s+1 failed \| 0 passed \(1\)/);
    expect(child.output).not.toContain("999 passed");
    const counts = guardianExec.parseCounts(child.output, "");
    expect(counts).toMatchObject({ failed: 1, passed: 0, total: 1 });
    expect(classifyRedRun({ status: guardianExec.classify(1, child.output, ""), testCounts: counts }).kind).toBe("assertion-failure");
  });

  it("refuses a settled or master receipt for discard", async () => {
    const a = fixture("a", 'import { it, expect } from "vitest"; import { readFileSync } from "node:fs"; it("a", () => { expect(readFileSync(new URL("./state.txt", import.meta.url), "utf8")).toBe("green"); });');
    writeFileSync(join(root, "tests/state.txt"), "red");
    expect((await command("record", "--id", "A", "--test", a)).status).toBe(0);
    writeFileSync(join(root, "tests/state.txt"), "green");
    expect((await command("verify", "--id", "A")).status).toBe(0);
    expect((await command("discard", "--id", "A")).status).toBe(64);
    const saved = JSON.parse(readFileSync(item("A"), "utf8"));
    saved.verdict = null;
    writeFileSync(item("A"), `${JSON.stringify(saved, null, 2)}\n`);
    (await run("git", ["add", ".claude/tdd-guardian/receipts"]));
    (await run("git", ["commit", "-qm", "master receipt"]));
    (await run("git", ["branch", "-f", "master", "HEAD"]));
    expect((await command("discard", "--id", "A")).status).toBe(64);
  });

  it("refuses settled or master ids at record, and edited genuine REDs at discard", async () => {
    const a = fixture("a", 'import { it } from "vitest"; it("a", () => { throw Error("red"); });');
    expect((await command("record", "--id", "A", "--test", a)).status).toBe(0);
    const before = bytes();
    fixture("a", 'import { it } from "vitest"; it("a", () => { throw Error("changed"); });');
    expect((await command("discard", "--id", "A")).status).toBe(64);
    expect(bytes()).toBe(before);
    fixture("a", 'import { it } from "vitest"; it("a", () => {});');
    expect((await command("verify", "--id", "A")).status).not.toBe(0);
    expect((await command("record", "--id", "A", "--test", a)).status).toBe(64);
  });

  it("checks pending branch receipts for the landing verifier", async () => {
    const a = fixture("a", 'import { it } from "vitest"; it("a", () => { throw Error("red"); });');
    expect((await command("check-pending")).status).toBe(0);
    expect((await command("record", "--id", "A", "--test", a)).status).toBe(0);
    expect((await command("check-pending")).status).toBe(1);
    expect((await command("discard", "--id", "A")).status).toBe(0);
    expect((await command("check-pending")).status).toBe(0);
  });

  it("overrides a leaked caller selection and refuses direct unmarked verify", async () => {
    const a = fixture("a", 'import { it } from "vitest"; it("a", () => { throw Error("red"); });');
    const b = fixture("b", 'import { it } from "vitest"; it("b", () => { throw Error("red"); });');
    const leaked = { MDPRO_UNIT_RED_FILES: JSON.stringify([b]) };
    expect((await run(process.execPath, [entry, "record", "--id", "A", "--test", a, "--cwd", root], leaked)).status).toBe(0);
    expect(Object.keys(store()[0].test_files)).toEqual([a]);
    expect((await command("record", "--id", "B", "--test", b)).status).toBe(0);
    fixture("a", 'import { it } from "vitest"; it("a", () => {});');
    fixture("b", 'import { it } from "vitest"; it("b", () => {});');
    (await run(process.execPath, [guardian, "verify", "--cwd", root], leaked));
    expect(store().map((receipt) => receipt.verdict)).toEqual([null, null]);
    expect(JSON.parse(readFileSync(view(), "utf8")).receipts.map((receipt: { verdict: string | null }) => receipt.verdict)).toEqual([null, null]);
  });

  it("refuses a master id at record and a missing master ref at discard", async () => {
    const a = fixture("a", 'import { it } from "vitest"; it("a", () => { throw Error("red"); });');
    expect((await command("record", "--id", "A", "--test", a)).status).toBe(0);
    (await run("git", ["add", ".claude/tdd-guardian/receipts"]));
    (await run("git", ["commit", "-qm", "receipt"]));
    (await run("git", ["branch", "-f", "master", "HEAD"]));
    const before = bytes();
    expect((await command("record", "--id", "A", "--test", a)).status).toBe(64);
    expect(bytes()).toBe(before);
    (await run("git", ["branch", "-m", "master", "main"]));
    expect((await command("discard", "--id", "A")).status).toBe(64);
  });

  it("rejects branch receipts with weak REDs or nonfinal verdicts at handoff", async () => {
    const a = fixture("a", 'import { it } from "vitest"; it("a", () => { throw Error("red"); });');
    expect((await command("record", "--id", "A", "--test", a)).status).toBe(0);
    const file = item("A");
    const saved = JSON.parse(readFileSync(file, "utf8"));
    // RC5 (ruling 1, opus M3): the strict load runs the engine's validateReceipts on every item, so a
    // verdict the engine would not persist (PENDING, an unknown word) is refused outright, naming the
    // file; a decided non-final verdict still reaches review and exits 1.
    for (const [verdict, status] of [["PENDING", 64], ["SEPARATION-BROKEN", 1], ["x", 64]] as const) {
      saved.verdict = verdict;
      writeFileSync(file, `${JSON.stringify(saved, null, 2)}\n`);
      const result = await command("check-pending");
      expect(result.status, verdict).toBe(status);
      if (status === 64) expect(result.output).toContain("receipts/A.json");
    }
    saved.verdict = "SEPARATION-HELD";
    saved.red.kind = "opaque-failure";
    writeFileSync(file, `${JSON.stringify(saved, null, 2)}\n`);
    expect((await command("check-pending")).status).toBe(1);
  });

  it("documents the sanctioned receipt entry and verifies pending branch receipts", () => {
    const rule10 = readFileSync(join(repo, ".claude/rules/10-tdd.md"), "utf8");
    const rule71 = readFileSync(join(repo, ".claude/rules/71-herdr-mixed-roster.md"), "utf8");
    const verifier = readFileSync(join(repo, ".claude/agents/mdpro-landing-verifier.md"), "utf8");
    for (const rule of [rule10, rule71]) {
      expect(rule).toContain("scripts/tdd/red-receipt.mjs");
      expect(rule).toContain("2 workers");
    }
    expect(rule10).toContain("direct receipt.js");
    expect(verifier).toContain("check-pending");
  });
  it("rejects Unicode spelling drift and a symlinked parent", async () => {
    fixture("café", 'import { it } from "vitest"; it("a", () => { throw Error("red"); });');
    const before = bytes();
    expect((await command("record", "--id", "A", "--test", "tests/cafe\u0301.test.ts")).status).toBe(64);
    writeFileSync(join(root, "scripts/x.test.ts"), ""); symlinkSync("../scripts", join(root, "tests/ext"));
    expect((await command("record", "--id", "A", "--test", "tests/ext/x.test.ts")).status).toBe(64);
    expect(bytes()).toBe(before);
    expect((await command("record", "--id", "A", "--test", "tests/café.test.ts")).status).toBe(0);
  });
  // Title kept for the CI inventory id. RC5 (R-e): discard reads and writes only its own id's files, so an entry the plugin would drop
  // can no longer be lost by a rewrite; discard succeeds and leaves that file byte-identical.
  it("refuses discard when the store has an entry the plugin would drop", async () => {
    const a = fixture("a", 'import { it } from "vitest"; it("a", () => { throw Error("red"); });');
    expect((await command("record", "--id", "A", "--test", a)).status).toBe(0);
    const file = item("bad");
    writeFileSync(file, `${JSON.stringify({ id: "bad", red: { kind: "green" }, test_files: { [a]: {} } }, null, 2)}\n`);
    const before = readFileSync(file, "utf8"); expect((await command("discard", "--id", "A")).status).toBe(0);
    expect(readFileSync(file, "utf8")).toBe(before);
    expect(existsSync(item("A"))).toBe(false);
  });
  it("keeps logs outside tracked source and a second RED clean", async () => {
    const a = fixture("a", 'import { it } from "vitest"; it("a", () => { throw Error("red"); });');
    const b = fixture("b", 'import { it } from "vitest"; it("b", () => { throw Error("red"); });');
    (await run("git", ["add", a, b])); (await run("git", ["commit", "-qm", "specs"]));
    const first = (await command("record", "--id", "A", "--test", a));
    expect(first.status).toBe(0);
    const log = first.output.match(/\[red-receipt\] log: ([^\n]+)/)?.[1]; expect(log).toBeTruthy();
    expect(readFileSync(log!, "utf8")).toContain("failed");
    expect((await command("record", "--id", "B", "--test", b)).status).toBe(0); expect(store().find((r) => r.id === "B")?.dirty_source).toEqual([]);
    expect((await run("git", ["status", "--porcelain"])).output).not.toContain("scripts/tdd");
  });
});
