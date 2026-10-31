// @vitest-environment node
/**
 * T566-F2-1 (#566 fix 2, AC-F2-1/2): the receipt suites stay local-only. On a GitHub runner (`RUNNER_OS` set) every
 * test tagged `plugin` in `tests/ci-inventory.json` skips and the CI comparator passes, so ADR-0128's split is kept;
 * and no test reaches a plugin cache, globs the vendor tree or hard-codes the engine version. Ungated: runs on CI too.
 * Forbidden names are built from pieces, so this file needs no allowlist entry of its own.
 */
import { readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { childVitest } from "../support/t566Child";
import { repoRoot } from "../support/t566Engine";
import { createOwnerChildRunner } from "./d302Child";

vi.setConfig({ testTimeout: 600_000 });
type Entry = { id: string[]; prerequisite: string };
const inventory = JSON.parse(readFileSync(join(repoRoot, "tests/ci-inventory.json"), "utf8")) as { schemaVersion: number; tests: Entry[]; exclusions: Array<{ id: string[] }> };
const CACHE_FREE = "tests/tooling/t566-fix2-cache-free.test.ts";
/** The 39 receipt suites tagged `plugin` before fix 2 (255 ids); fix 2 adds only `CACHE_FREE`. */
const RECEIPT_SUITES = [
  ...["digest-stable", "digest-text", "digest", "holes", "launcher-bound", "lock-wait-bound", "message-fallback", "normalise-law", "pin",
    "pre-entry-incomplete", "pre-entry", "print", "record-evidence", "replay-env", "replay-fail", "replay-killed", "replay-pass", "replay-prune",
    "rust-lane", "worktree-owner"].map((name) => `adr0149e-${name}`),
  "red-receipt-boundary", "red-receipt-flock", "red-receipt-race", "red-receipt", "unit-red-lane",
  ...["-advanced", "-async-attempts", "-async-late", "-async-provenance", "-async-unawaited", "-chain", "-delayed-soft", "-provenance", "-review",
    "-scoped", "-soft-pending", "-soft", ""].map((suffix) => `unit-red-phase${suffix}`),
  "unit-red-runner-hygiene",
].map((name) => `tests/tooling/${name}.test.ts`);
const pluginEntries = inventory.tests.filter((item) => item.prerequisite === "plugin");
const pluginFiles = [...new Set(pluginEntries.map((item) => item.id[0]))].sort();
const COLLECT_ONLY_MS = 45_000;
const scratch: string[] = [];
afterEach(() => { for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("T566-F2-1 the plugin inventory is conserved", () => {
  it("tags exactly the 39 receipt suites (255 ids) and the cache-free file, with the exclusions unchanged", () => {
    expect(pluginFiles).toEqual([...RECEIPT_SUITES, CACHE_FREE].sort());
    expect(pluginEntries.filter((item) => item.id[0] !== CACHE_FREE)).toHaveLength(255);
    expect(inventory.exclusions).toHaveLength(73);
    expect(inventory.exclusions.map((item) => item.id)).toContainEqual(["tests/tooling/unit-red-phase.test.ts", "D302 owner cleanup probe"]);
  });
});

describe("T566-F2-1 receipt suites skip on GitHub runners", () => {
  for (const [os, profile] of [["Linux", "ubuntu"], ["macOS", "macos"]] as const) {
    it(`skips every plugin-tagged test with RUNNER_OS=${os}, and the ${profile} comparator passes`, async ({ signal }) => {
      // Skipped suites only collect (about 3 s); a suite that runs instead is cut off rather than run to the end.
      const run = await childVitest(signal, pluginFiles, { RUNNER_OS: os }, COLLECT_ONLY_MS);
      scratch.push(run.dir);
      expect(run.failed).toEqual([]);
      const statuses = pluginEntries.map((item) => [item.id.join(" > "), run.statuses.get(JSON.stringify(item.id))]);
      expect(statuses.filter(([, status]) => status !== "skipped"), run.output.slice(-2000)).toEqual([]);
      const ownIds = [...run.statuses.keys()].filter((id) => JSON.parse(id)[0] === CACHE_FREE).sort();
      expect(ownIds).toEqual(pluginEntries.filter((item) => item.id[0] === CACHE_FREE).map((item) => JSON.stringify(item.id)).sort());
      const filtered = join(run.dir, "inventory.json");
      writeFileSync(filtered, JSON.stringify({
        schemaVersion: inventory.schemaVersion,
        tests: pluginEntries,
        exclusions: inventory.exclusions.filter((item) => pluginFiles.includes(item.id[0])),
      }));
      const owner = createOwnerChildRunner(signal);
      try {
        const compared = await owner.run(process.execPath, [join(repoRoot, "scripts/ci/compare-report.mjs"), "ci", run.report, filtered, profile, repoRoot], { cwd: repoRoot, timeout: 60_000 });
        expect(compared.stdout, compared.stderr).toMatch(/^ci inventory PASS/m);
      } finally { await owner.close(); }
    });
  }
});

/** Every file under `dir`, relative to the repo. */
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [relative(repoRoot, path)];
  });
}
const read = (file: string) => readFileSync(join(repoRoot, file), "utf8");
const word = (...parts: string[]) => parts.join("");
const CACHE_NAME = new RegExp([word("xiao", "lai"), word("plugins", "\\/", "cache"), word("\\.claude", "\\/", "plugins"), word("\\.codex", "\\/", "plugins")].join("|"));
const VENDOR_PATH = new RegExp(`${word("tdd", "\\/", "vendor")}|${word("tdd-guard", "ian-")}\\d`);
const HOME_READ = new RegExp([
  word("home", "dir"), word("process\\.env", "\\.HOME"), `${word("user", "Info")}\\s*\\(`, `["'\`]${word("plu", "gins")}["'\`]`, word("xiao", "lai"),
].join("|"), "g");

/** HOME normalisation is this suite's subject: it imports `homedir` (also inside a fixture) and makes a root under `~/.cache`. */
const DIGEST_TEXT = "tests/tooling/adr0149e-digest-text.test.ts";
const HOME_SUBJECT = /import \{ homedir, tmpdir \} from "node:os";|join\(homedir\(\), "\.cache"/;

describe("T566-F2-1 no test reaches a plugin cache or the vendor tree on its own", () => {
  const all = walk(join(repoRoot, "tests"));
  it("names a plugin cache only in the poison builder and two literal-only files", () => {
    expect(all.filter((file) => CACHE_NAME.test(read(file))).sort()).toEqual([
      "tests/support/t566Engine.ts", "tests/tooling/d187-receipt-rustfmt-guard.test.ts", "tests/tooling/t566-vendor-manifest.test.ts",
    ]);
  });
  it("reaches the vendored engine only through t566Engine's vendorDir", () => {
    expect(all.filter((file) => VENDOR_PATH.test(read(file))).sort()).toEqual([
      "tests/support/t566Engine.ts", "tests/tooling/t566-fail-closed.test.ts", "tests/tooling/t566-vendor-manifest.test.ts",
    ]);
  });
  it("reads no HOME in any receipt suite (bar digest-text's subject), and gates each on receiptSuites, pluginVersion or rustfmt", () => {
    const exempt: string[] = [];
    for (const file of [...pluginFiles, "tests/tooling/adr0149eRepo.ts", "tests/tooling/fixtures/unit-red/scenarios.mjs", "tests/support/t566Child.ts"]) {
      const text = read(file);
      const reads = text.split("\n").filter((line) => line.match(HOME_READ));
      expect(reads.filter((line) => !(file === DIGEST_TEXT && HOME_SUBJECT.test(line))), file).toEqual([]);
      for (const [, predicate] of text.matchAll(/\.(?:skipIf|runIf)\(([^)]*\)?)\)/g)) {
        if (predicate.includes("D302_OWNER_INNER")) { exempt.push(file); continue; }
        for (const term of predicate.split("||")) expect(term.trim(), `${file}: ${predicate}`).toMatch(file === CACHE_FREE ? /^!local$/ : /^!(receiptSuites|pluginVersion|rustfmt)$/);
      }
    }
    expect(exempt).toEqual(["tests/tooling/unit-red-phase.test.ts"]);
  });
  it("defines the gate as 'not a GitHub runner', and takes the version and engine from t566Engine", () => {
    expect(read("tests/support/t566Engine.ts")).toMatch(/^export const receiptSuites = !process\.env\.RUNNER_OS;$/m);
    expect(read("tests/tooling/adr0149eRepo.ts")).toMatch(/^export const pluginVersion = receiptSuites \? ENGINE_VERSION : null;$/m);
    for (const file of ["tests/tooling/adr0149eRepo.ts", "tests/tooling/red-receipt.test.ts", "tests/tooling/unit-red-lane.test.ts"]) {
      expect(read(file), file).toMatch(/from "\.\.\/support\/t566Engine";/);
      expect(read(file).match(/\b\d+\.\d+\.\d+\b/g), file).toBeNull();
    }
  });
  it("hands bare_record its receipt.js instead of finding one", () => {
    const scenarios = read("tests/tooling/fixtures/unit-red/scenarios.mjs");
    expect(scenarios).not.toMatch(/readdirSync|["'`]vendor["'`]/);
    expect(scenarios).toMatch(/const \[scenario, repo, receiptScript\] = process\.argv\.slice\(2\);/);
    expect(read("tests/tooling/unit-red-lane.test.ts")).toMatch(/\[script, name, repo, join\(vendorDir, "receipt\.js"\)\]/);
  });
});
