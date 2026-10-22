// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const run = promisify(execFile);
const repo = path.resolve(import.meta.dirname, "../..");
const lint = path.join(repo, "scripts/lint/conditional-tests.mjs");
const comparator = path.join(repo, "scripts/ci/compare-report.mjs");

describe("ADR128 collection gate before parity", () => {
  it("rejects a vanished fixture registration that comparator and parity cannot see", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "adr128-vanish-"));
    try {
      const file = path.join(root, "tests/case.test.ts");
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, "import { describe, it } from 'vitest'; const plugin = false; describe('suite', () => { if (!plugin) return; it('lost', () => {}); }); it('visible', () => {});\n");
      const report = { success: true, testResults: [{ name: file, status: "passed", assertionResults: [{ ancestorTitles: [], title: "visible", status: "passed" }] }] };
      const ci = path.join(root, "ci.json");
      const local = path.join(root, "local.json");
      const inventory = path.join(root, "inventory.json");
      fs.writeFileSync(ci, JSON.stringify(report));
      fs.writeFileSync(local, JSON.stringify(report));
      fs.writeFileSync(inventory, JSON.stringify({ schemaVersion: 1, tests: [], exclusions: [] }));
      const compared = await run(process.execPath, [comparator, "ci", ci, inventory, "ubuntu", root], { cwd: repo });
      const parity = await run(process.execPath, [comparator, "parity", ci, local, inventory, root, root, "ubuntu"], { cwd: repo });
      expect(compared.stdout).toContain("inventory PASS");
      expect(parity.stdout).toContain("PARITY PASS");
      const linted = await run(process.execPath, [lint, file], { cwd: repo }).then(
        () => ({ status: 0, stderr: "" }),
        (error: { code: number; stderr: string }) => ({ status: error.code, stderr: error.stderr }),
      );
      expect(linted.status).not.toBe(0);
      expect(linted.stderr).toContain("conditional");
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
  it("fails collection and both report checks when runtime cases are empty", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "adr128-empty-cases-"));
    try {
      fs.mkdirSync(path.join(root, "tests"), { recursive: true });
      fs.symlinkSync(path.join(repo, "node_modules"), path.join(root, "node_modules"));
      const config = path.join(root, "vitest.config.mjs");
      fs.writeFileSync(config, 'export default { test: { include: ["tests/**/*.test.ts"], environment: "node" } };\n');
      fs.writeFileSync(path.join(root, "tests/case.test.ts"), `import { it } from "vitest"; import { collectionCases } from ${JSON.stringify(path.join(repo, "tests/support/collectionCases.ts"))}; for (const row of collectionCases("fixture", [])) it(String(row), () => {});\n`);
      const cli = path.join(repo, "node_modules/vitest/vitest.mjs");
      const collected = await run(process.execPath, [cli, "list", "--root", root, "--config", config, "--json=" + path.join(root, "ci.json")], { cwd: repo }).then(
        () => ({ status: 0, output: "" }),
        (error: { code: number; stdout: string; stderr: string }) => ({ status: error.code, output: error.stdout + error.stderr }),
      );
      expect(collected.status).not.toBe(0);
      expect(collected.output).toContain("empty collection: fixture");
      const inventory = path.join(root, "inventory.json");
      fs.writeFileSync(inventory, JSON.stringify({ schemaVersion: 1, tests: [], exclusions: [] }));
      for (const mode of ["ci", "parity"]) {
        const args = mode === "ci"
          ? [comparator, "ci", path.join(root, "ci.json"), inventory, "ubuntu", root]
          : [comparator, "parity", path.join(root, "ci.json"), path.join(root, "local.json"), inventory, root, root, "ubuntu"];
        const checked = await run(process.execPath, args, { cwd: repo }).then(
          () => ({ status: 0, output: "" }),
          (error: { code: number; stderr: string }) => ({ status: error.code, output: error.stderr }),
        );
        expect(checked.status, mode).not.toBe(0);
        expect(checked.output, mode).toMatch(/ENOENT.*ci\.json/);
      }
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
  it("collects a nonempty guarded runtime case and passes both report checks", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "adr128-nonempty-cases-"));
    try {
      fs.mkdirSync(path.join(root, "tests"), { recursive: true });
      fs.symlinkSync(path.join(repo, "node_modules"), path.join(root, "node_modules"));
      const config = path.join(root, "vitest.config.mjs");
      fs.writeFileSync(config, 'export default { test: { include: ["tests/**/*.test.ts"], environment: "node" } };\n');
      const file = path.join(root, "tests/case.test.ts");
      fs.writeFileSync(file, `import { it } from "vitest"; import { collectionCases } from ${JSON.stringify(path.join(repo, "tests/support/collectionCases.ts"))}; for (const row of collectionCases("fixture", [1])) it("visible " + row, () => {});\n`);
      const listed = path.join(root, "listed.json");
      const cli = path.join(repo, "node_modules/vitest/vitest.mjs");
      await run(process.execPath, [cli, "list", "--root", root, "--config", config, "--json=" + listed], { cwd: repo });
      const names = (JSON.parse(fs.readFileSync(listed, "utf8")) as Array<{ name: string }>).map((item) => item.name);
      expect(names).toEqual(["visible 1"]);
      const report = { success: true, testResults: [{ name: file, status: "passed", assertionResults: [{ ancestorTitles: [], title: "visible 1", status: "passed" }] }] };
      const ci = path.join(root, "ci.json"), local = path.join(root, "local.json"), inventory = path.join(root, "inventory.json");
      fs.writeFileSync(ci, JSON.stringify(report)); fs.writeFileSync(local, JSON.stringify(report));
      fs.writeFileSync(inventory, JSON.stringify({ schemaVersion: 1, tests: [], exclusions: [] }));
      expect((await run(process.execPath, [comparator, "ci", ci, inventory, "ubuntu", root], { cwd: repo })).stdout).toContain("inventory PASS");
      expect((await run(process.execPath, [comparator, "parity", ci, local, inventory, root, root, "ubuntu"], { cwd: repo })).stdout).toContain("PARITY PASS");
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});
