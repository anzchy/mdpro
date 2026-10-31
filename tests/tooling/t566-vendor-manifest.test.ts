// @vitest-environment node
/**
 * T566-2 (#566 AC-3, AC-5, AC-6, AC-8): the vendored receipt engine is pinned. Its README
 * lists every file with its SHA-256, those hashes equal the upstream 0.10.2 bytes, and the
 * manifest check catches a changed, missing or unlisted file. The exec.js patch is not
 * needed because the repo's lane wrappers keep the engine off both holes it fixes, and the
 * CI inventory's `plugin` prerequisite reads the vendored engine, not the cache.
 */
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { classifyCargoExit } from "../../scripts/cargo-test-lane.mjs";
import { ENGINE_VERSION, PINNED, checkVendor, makeHome, manifestRows, repoRoot, sha256, vendorDir } from "../support/t566Engine";
import { createOwnerChildRunner } from "./d302Child";

vi.setConfig({ testTimeout: 60_000 });
const temps: string[] = [];
afterEach(() => { for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const temp = () => { const dir = mkdtempSync(join(tmpdir(), "mdpro-t566-")); temps.push(dir); return dir; };
/** A copy of the vendored directory, to tamper with. */
function copy() {
  const dir = join(temp(), "engine");
  if (existsSync(vendorDir)) cpSync(vendorDir, dir, { recursive: true });
  return dir;
}
const files = ["receipt.js", "lib/config.js", "lib/coverage.js", "lib/exec.js", "lib/lanes.js", "lib/verification.js", "LICENSE", "package.json"];

describe("T566-2 the vendored engine is pinned", () => {
  it("passes the manifest check, and every hash equals the pinned upstream bytes", () => {
    expect(checkVendor(vendorDir)).toEqual([]);
    expect(Object.fromEntries(manifestRows(vendorDir))).toEqual(PINNED);
    expect(files).toEqual(Object.keys(PINNED));
    for (const file of files) expect(existsSync(join(vendorDir, file)) && sha256(join(vendorDir, file)), file).toBe(PINNED[file]);
  });

  it.each(files)("reports a changed %s, and nothing else", (file) => {
    const dir = copy();
    expect(existsSync(join(dir, file)), file).toBe(true);
    appendFileSync(join(dir, file), "\n");
    expect(checkVendor(dir)).toEqual([`sha256 mismatch: ${file}`]);
  });

  it("reports a missing closure file", () => {
    const dir = copy();
    rmSync(join(dir, "lib/coverage.js"), { force: true });
    expect(checkVendor(dir)).toEqual(["missing: lib/coverage.js"]);
  });

  it("reports unlisted files, hidden and nested ones too", () => {
    const dir = copy();
    mkdirSync(join(dir, "lib/sub"), { recursive: true });
    for (const file of ["lib/extra.js", ".DS_Store", "lib/sub/x.js"]) writeFileSync(join(dir, file), "x");
    expect(checkVendor(dir)).toEqual([".DS_Store", "lib/extra.js", "lib/sub/x.js"].map((file) => `unlisted: ${file}`));
  });

  it("reports a file whose README row was removed, and a duplicated row", () => {
    const dir = copy();
    const readme = join(dir, "README.md");
    expect(existsSync(readme)).toBe(true);
    const text = readFileSync(readme, "utf8");
    const row = text.split("\n").find((line) => line.includes("`lib/lanes.js`")) ?? "";
    expect(row).not.toBe("");
    writeFileSync(readme, text.replace(`${row}\n`, ""));
    expect(checkVendor(dir)).toEqual(["unlisted: lib/lanes.js"]);
    writeFileSync(readme, text.replace(`${row}\n`, `${row}\n${row}\n`));
    expect(checkVendor(dir)).toEqual(["duplicate: lib/lanes.js"]);
  });

  it("holds the whole require closure, and nothing reaches outside it", () => {
    const required = new Set<string>();
    for (const file of files.filter((name) => name.endsWith(".js"))) {
      expect(existsSync(join(vendorDir, file)), file).toBe(true);
      for (const match of readFileSync(join(vendorDir, file), "utf8").matchAll(/require\("(\.[^"]+)"\)/g)) {
        required.add(join(file.includes("/") ? "lib" : "", `${match[1]}.js`).replace(/^lib\/lib\//, "lib/"));
      }
    }
    expect([...required].sort()).toEqual(["lib/config.js", "lib/coverage.js", "lib/exec.js", "lib/lanes.js", "lib/verification.js"]);
  });

  it("is the one vendored version, and both scripts name it", () => {
    const vendor = join(repoRoot, "scripts/tdd/vendor");
    expect(existsSync(vendor) ? readdirSync(vendor).filter((name) => name.startsWith("tdd-guardian-")) : []).toEqual([`tdd-guardian-${ENGINE_VERSION}`]);
    for (const script of ["scripts/tdd/red-receipt.mjs", "scripts/ci/verify-inventory.mjs"]) {
      expect(readFileSync(join(repoRoot, script), "utf8"), script).toContain(`tdd-guardian-${ENGINE_VERSION}`);
    }
  });

  it("carries the ISC licence and its provenance", () => {
    const license = existsSync(join(vendorDir, "LICENSE")) ? readFileSync(join(vendorDir, "LICENSE"), "utf8") : "";
    expect(license).toContain("ISC License");
    expect(license).toContain("Copyright (c) 2026 Xiaolai Li");
    const readme = existsSync(join(vendorDir, "README.md")) ? readFileSync(join(vendorDir, "README.md"), "utf8") : "";
    expect(readme).toContain(`Source version: \`${ENGINE_VERSION}\``);
    expect(readme).toContain(`~/.claude/plugins/cache/xiaolai/tdd-guardian/${ENGINE_VERSION}/scripts/tdd-guardian/`);
    expect(readme).toContain("https://github.com/xiaolai/tdd-guardian-for-claude");
    expect(readme).toMatch(/^Patch: not applied\./m);
  });
});

describe("T566-2 the exec.js patch is not needed", () => {
  const load = () => {
    expect(existsSync(join(vendorDir, "lib/exec.js"))).toBe(true);
    return createRequire(import.meta.url)(join(vendorDir, "lib/exec.js")) as {
      parseCounts: (text: string) => Record<string, number> | null; classify: (code: number, stdout: string, stderr: string) => string;
    };
  };

  it("parses the line unit-red-lane.mjs prints", () => {
    const exec = load();
    expect(exec.parseCounts("Tests  1 failed | 2 passed (3)\n")).toEqual({ failed: 1, passed: 2, skipped: 0, total: 3 });
    expect(exec.parseCounts("Tests  0 failed | 3 passed (3)\n")).toEqual({ failed: 0, passed: 3, skipped: 0, total: 3 });
    expect(readFileSync(join(repoRoot, "scripts/tdd/unit-red-lane.mjs"), "utf8")).toContain("process.stdout.write(`Tests  ${counts.failed} failed | ${counts.passed} passed (${counts.total})\\n`);");
  });

  it("reads the normalised line past a Vitest todo line, which the patch exists for", () => {
    const exec = load();
    expect(exec.parseCounts("Tests  1 failed | 2 passed | 1 todo (4)\nTests  1 failed | 2 passed (3)\n")).toEqual({ failed: 1, passed: 2, skipped: 0, total: 3 });
  });

  it("never sees cargo's 101: the wrapper turns a FAILED summary into exit 1, which the engine reads as a failure", () => {
    expect(classifyCargoExit({ code: 101, signal: null, sawFailedSummary: true })).toEqual({ exit: 1 });
    expect(load().classify(1, "test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out\n", "")).toBe("fail");
  });

  it("keeps exec.js at its unpatched upstream bytes", () => {
    expect(existsSync(join(vendorDir, "lib/exec.js")) && sha256(join(vendorDir, "lib/exec.js"))).toBe(PINNED["lib/exec.js"]);
  });
});

describe("T566-2 the inventory's plugin prerequisite reads the vendored engine", () => {
  async function probe(withVendor: boolean, signal: AbortSignal) {
    const root = temp();
    writeFileSync(join(root, "package.json"), '{"type":"module"}\n');
    mkdirSync(join(root, "scripts/ci"), { recursive: true });
    for (const file of ["verify-inventory.mjs", "compare-report.mjs"]) cpSync(join(repoRoot, "scripts/ci", file), join(root, "scripts/ci", file));
    if (withVendor && existsSync(vendorDir)) cpSync(vendorDir, join(root, `scripts/tdd/vendor/tdd-guardian-${ENGINE_VERSION}`), { recursive: true });
    writeFileSync(join(root, "tests-inventory.json"), JSON.stringify({ schemaVersion: 1, tests: [{ id: ["tests/x.test.ts", "x"], prerequisite: "plugin" }], exclusions: [] }));
    const { home } = makeHome(true);
    temps.push(home);
    const owner = createOwnerChildRunner(signal);
    const env = { ...process.env, HOME: home };
    const script = `import { hasPrerequisite } from ${JSON.stringify(join(root, "scripts/ci/verify-inventory.mjs"))}; process.stdout.write(String(hasPrerequisite("plugin")));`;
    const answer = await owner.run(process.execPath, ["--input-type=module", "-e", script], { cwd: root, env, timeout: 30_000 });
    const cliScript = `import { verifyInventory } from ${JSON.stringify(join(root, "scripts/ci/verify-inventory.mjs"))}; import fs from "node:fs"; const r = verifyInventory({ root: ${JSON.stringify(root)}, inventory: JSON.parse(fs.readFileSync("tests-inventory.json", "utf8")), execute: () => ({ status: 1 }) }); process.stdout.write(JSON.stringify(r));`;
    const run = await owner.run(process.execPath, ["--input-type=module", "-e", cliScript], { cwd: root, env, timeout: 30_000 });
    await owner.close();
    return { answer: answer.stdout, result: run.stdout ? JSON.parse(run.stdout) : null };
  }

  it("is false without the vendored engine, even with a full cache in HOME", async ({ signal }) => {
    const { answer, result } = await probe(false, signal);
    expect(answer).toBe("false");
    expect(result).toEqual({ ok: false, error: "Unavailable prerequisite: plugin" });
  });

  it("is true with the vendored engine", async ({ signal }) => {
    const { answer, result } = await probe(true, signal);
    expect(answer).toBe("true");
    expect(result.error).not.toBe("Unavailable prerequisite: plugin");
  });
});
