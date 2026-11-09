// @vitest-environment node
/**
 * T566-F2-1 (#566 fix 2, AC-F2-1/2): the receipt suites stay local-only. On a GitHub runner (`RUNNER_OS` set) every
 * test tagged `plugin` in `tests/ci-inventory.json` skips and the CI comparator passes, so ADR-0128's split is kept;
 * and no test reaches a plugin cache, globs the vendor tree or hard-codes the engine version. Ungated: runs on CI too.
 * Forbidden names are built from pieces, so this file needs no allowlist entry of its own. #569 T-01 adds one named
 * non-receipt file, `t567-mattpocock-version.test.ts`, whose single live case reads the real caches by design.
 */
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { childDiagnostic, childOutcome, childVitest } from "../support/t566Child";
import { repoRoot } from "../support/t566Engine";
import { createOwnerChildRunner } from "./d302Child";

vi.setConfig({ testTimeout: 600_000 });
type Entry = { id: string[]; prerequisite: string };
const inventory = JSON.parse(readFileSync(join(repoRoot, "tests/ci-inventory.json"), "utf8")) as { schemaVersion: number; tests: Entry[]; exclusions: Array<{ id: string[] }> };
const CACHE_FREE = "tests/tooling/t566-fix2-cache-free.test.ts";
/** #569 T-01's live case: not a receipt suite. It reads the real plugin caches on a developer Mac by design, so it carries one `plugin` id. */
const MATTPOCOCK = "tests/tooling/t567-mattpocock-version.test.ts";
const MATTPOCOCK_HOME = /^\s*const home = os\.homedir\(\);$/;
const MATTPOCOCK_PREDICATE = "liveCaseEnabled(process)";
/** The 39 receipt suites tagged `plugin` before fix 2 (255 ids); fix 2 adds only `CACHE_FREE`. RC5 adds its three entry suites (24 ids): 42 suites, 279 ids. D357 adds `rc5-receipt-lifecycle` (12 ids): 43 suites, 291 ids. */
const RECEIPT_SUITES = [
  ...["digest-stable", "digest-text", "digest", "holes", "launcher-bound", "lock-wait-bound", "message-fallback", "normalise-law", "pin",
    "pre-entry-incomplete", "pre-entry", "print", "record-evidence", "replay-env", "replay-fail", "replay-killed", "replay-pass", "replay-prune",
    "rust-lane", "worktree-owner"].map((name) => `adr0149e-${name}`),
  "red-receipt-boundary", "red-receipt-flock", "red-receipt-race", "red-receipt", "unit-red-lane",
  ...["-advanced", "-async-attempts", "-async-late", "-async-provenance", "-async-unawaited", "-chain", "-delayed-soft", "-provenance", "-review",
    "-scoped", "-soft-pending", "-soft", ""].map((suffix) => `unit-red-phase${suffix}`),
  "unit-red-runner-hygiene", "rc5-receipt-entry", "rc5-receipt-view", "rc5-view-lane", "rc5-receipt-lifecycle",
].map((name) => `tests/tooling/${name}.test.ts`);
const pluginEntries = inventory.tests.filter((item) => item.prerequisite === "plugin");
const pluginFiles = [...new Set(pluginEntries.map((item) => item.id[0]))].sort();
/**
 * The child-run budget. The child runs whole files, so ordinary tests (some spawning nested vitest runs) run alongside the
 * skipped plugin-tagged ones: 20–25 s on a Mac, 38–40 s on a CI shard, past 45 s on a loaded one (#674). Below `testTimeout`.
 */
const CHILD_RUN_MS = 120_000;
const scratch: string[] = [];
afterEach(() => { for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("T566-F2-1 the plugin inventory is conserved", () => {
  it("tags exactly the 43 receipt suites (291 ids), the cache-free file and T-01's one live case, with the exclusions unchanged", () => {
    expect(pluginFiles).toEqual([...RECEIPT_SUITES, CACHE_FREE, MATTPOCOCK].sort());
    expect(pluginEntries.filter((item) => item.id[0] !== CACHE_FREE && item.id[0] !== MATTPOCOCK)).toHaveLength(291);
    expect(pluginEntries.filter((item) => item.id[0] === MATTPOCOCK)).toHaveLength(1);
    expect(inventory.exclusions).toHaveLength(73);
    expect(inventory.exclusions.map((item) => item.id)).toContainEqual(["tests/tooling/unit-red-phase.test.ts", "D302 owner cleanup probe"]);
  });
});

describe("T566-F2-1 receipt suites skip on GitHub runners", () => {
  for (const [os, profile] of [["Linux", "ubuntu"], ["macOS", "macos"]] as const) {
    it(`skips every plugin-tagged test with RUNNER_OS=${os}, and the ${profile} comparator passes`, async ({ signal }) => {
      // A child that is cut off or exits non-zero rejects, or fails here first, with its status, budget, report and output.
      const run = await childVitest(signal, pluginFiles, { RUNNER_OS: os }, CHILD_RUN_MS);
      scratch.push(run.dir);
      expect(run.status, childDiagnostic(run)).toBe(0);
      expect(run.budget).toBe(CHILD_RUN_MS);
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

describe("GH674 a child that does not exit 0 fails first, naming its budget, report and output", () => {
  it("rejects a child killed at a 1 ms budget with the diagnostic, not with an empty report", async ({ signal }) => {
    const outcome = await childVitest(signal, [CACHE_FREE], { RUNNER_OS: "Linux" }, 1).then(
      (run) => { scratch.push(run.dir); return `resolved with ${run.statuses.size} statuses`; },
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );
    expect(outcome).toMatch(/^child vitest failed: status null, budget 1 ms, report \S*mdpro-t566f2-report-[^/\s]+\/vitest\.json \(absent\); output tail:/);
    const dir = outcome.match(/report (\S+)\/vitest\.json/)?.[1] ?? "";
    expect(existsSync(dir), dir).toBe(false);
  });

  it("rejects a non-zero exit that did write a report, quoting vitest's own failure", async ({ signal }) => {
    const message = await childVitest(signal, ["tests/tooling/gh674-no-such-file.test.ts"], {}, CHILD_RUN_MS).then(
      (run) => { scratch.push(run.dir); return "resolved"; },
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );
    const report = message.match(/report (\S+\/vitest\.json) \(exists\); output tail:\n/)?.[1];
    expect(message).toMatch(/^child vitest failed: status 1, budget 120000 ms, report \S+\/vitest\.json \(exists\); output tail:\n/);
    expect(message).toContain(`JSON report written to ${report}`);
  });

  /** A temp report file holding `text`; the dir joins `scratch`. */
  const tempReport = (text: string) => {
    const dir = mkdtempSync(join(tmpdir(), "mdpro-gh674-"));
    scratch.push(dir);
    writeFileSync(join(dir, "vitest.json"), text);
    return join(dir, "vitest.json");
  };

  it("rejects a child killed at its budget even when a report exists", () => {
    const report = tempReport('{"testResults":[]}');
    expect(() => childOutcome({ status: null, budget: 120_000, output: "", report })).toThrow(`child vitest failed: status null, budget 120000 ms, report ${report} (exists); output tail:\n`);
  });

  it("rejects a truncated report with the diagnostic and the parse error, not a bare SyntaxError", () => {
    const report = tempReport('{"testResults":[');
    expect(() => childOutcome({ status: 0, budget: 120_000, output: "partial", report })).toThrow(
      new RegExp(`^child vitest failed: status 0, budget 120000 ms, report ${report.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\(exists\\); output tail:\\npartial\\nreport unreadable: `),
    );
  });

  it("names status, budget and report, and quotes only the last 2000 characters of output", () => {
    const report = tempReport("{}");
    const output = `HEAD${"x".repeat(3000)}TAIL-MARK`;
    const text = childDiagnostic({ status: 1, budget: 120_000, output, report });
    expect(text).toBe(`status 1, budget 120000 ms, report ${report} (exists); output tail:\n${output.slice(-2000)}`);
    expect(text).not.toContain("HEAD");
  });
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
  it("names a plugin cache only in the poison builder, two literal-only files and T-01's live case", () => {
    expect(all.filter((file) => CACHE_NAME.test(read(file))).sort()).toEqual([
      "tests/support/t566Engine.ts", "tests/tooling/d187-receipt-rustfmt-guard.test.ts", "tests/tooling/t566-vendor-manifest.test.ts", MATTPOCOCK,
    ]);
  });
  it("reaches the vendored engine only through t566Engine's vendorDir", () => {
    expect(all.filter((file) => VENDOR_PATH.test(read(file))).sort()).toEqual([
      "tests/support/t566Engine.ts", "tests/tooling/t566-fail-closed.test.ts", "tests/tooling/t566-vendor-manifest.test.ts",
    ]);
  });
  it("reads no HOME in any receipt suite (bar digest-text's subject and T-01's live case), and gates each on receiptSuites, pluginVersion or rustfmt", () => {
    const exempt: string[] = [];
    for (const file of [...pluginFiles, "tests/tooling/adr0149eRepo.ts", "tests/tooling/fixtures/unit-red/scenarios.mjs", "tests/support/t566Child.ts"]) {
      const text = read(file);
      const reads = text.split("\n").filter((line) => line.match(HOME_READ));
      expect(reads.filter((line) => !(file === DIGEST_TEXT && HOME_SUBJECT.test(line)) && !(file === MATTPOCOCK && MATTPOCOCK_HOME.test(line))), file).toEqual([]);
      for (const [, predicate] of text.matchAll(/\.(?:skipIf|runIf)\(([^)]*\)?)\)/g)) {
        if (predicate.includes("D302_OWNER_INNER")) { exempt.push(file); continue; }
        if (file === MATTPOCOCK) { expect(predicate, file).toBe(MATTPOCOCK_PREDICATE); continue; }
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
