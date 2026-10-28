// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ts from "typescript";
import { afterEach, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");
const protectedFiles = [
  "tests/d182-build-mac-masked-failure.test.ts",
  "tests/tooling/d183-build-mac-product-checks.test.ts",
  "tests/tooling/adr141-ci-inventory.test.ts",
  "tests/tooling/codex-land-guard.test.ts",
];
const temporary: string[] = [];

function fixture(source: string): string {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "d332-timeout-")), "fifth.test.ts");
  temporary.push(path.dirname(file));
  fs.writeFileSync(file, source);
  return file;
}

afterEach(() => {
  for (const dir of temporary.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function caseTimeoutAudit(files: string[]): string[] {
  const violations: string[] = [];
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const importsSharedTimeout = ast.statements.some((statement) =>
      ts.isImportDeclaration(statement)
      && ts.isStringLiteral(statement.moduleSpecifier)
      && /(?:^|\/)spawnTestTimeout$/.test(statement.moduleSpecifier.text)
      && !!statement.importClause?.namedBindings
      && ts.isNamedImports(statement.importClause.namedBindings)
      && statement.importClause.namedBindings.elements.some((element) => element.name.text === "SPAWN_TEST_TIMEOUT_MS"),
    );
    function visit(node: ts.Node): void {
      if (ts.isCallExpression(node)) {
        const direct = ts.isIdentifier(node.expression) && node.expression.text === "it";
        const each = ts.isCallExpression(node.expression)
          && ts.isPropertyAccessExpression(node.expression.expression)
          && ts.isIdentifier(node.expression.expression.expression)
          && node.expression.expression.expression.text === "it"
          && node.expression.expression.name.text === "each";
        if (direct || each) {
          const title = node.arguments[0]?.getText(ast) ?? "<untitled>";
          const timeout = node.arguments[2];
          if (!importsSharedTimeout || !timeout || !ts.isIdentifier(timeout) || timeout.text !== "SPAWN_TEST_TIMEOUT_MS") {
            violations.push(`${path.basename(file)}: ${title}`);
          }
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
  }
  return violations;
}

const protectedSource = `import { SPAWN_TEST_TIMEOUT_MS } from "./spawnTestTimeout";\n`
  + `it("first", () => {}, SPAWN_TEST_TIMEOUT_MS);\n`
  + `it.each([1, 2])("middle %s", () => {}, SPAWN_TEST_TIMEOUT_MS);\n`
  + `it("last", () => {}, SPAWN_TEST_TIMEOUT_MS);\n`;

it("protects every case in the four real files", () => {
  expect(caseTimeoutAudit(protectedFiles.map((file) => path.join(root, file)))).toEqual([]);
});

it("reports an omitted timeout in a newly supplied fifth file", () => {
  const file = fixture('it("fifth", () => {});\n');
  expect(caseTimeoutAudit([file])).toEqual(['fifth.test.ts: "fifth"']);
});

it("reports an unprotected parameterized case", () => {
  const file = fixture('it.each(["first", "last"])("choice %s", () => {});\n');
  expect(caseTimeoutAudit([file])).toEqual(['fifth.test.ts: "choice %s"']);
});

it("reports only a removed timeout among protected neighbors, then clears on restoration", () => {
  const file = fixture(protectedSource);
  expect(caseTimeoutAudit([file])).toEqual([]);
  for (const title of ["first", "middle %s", "last"]) {
    const changed = protectedSource.replace(`"${title}", () => {}, SPAWN_TEST_TIMEOUT_MS`, `"${title}", () => {}`);
    fs.writeFileSync(file, changed);
    expect(caseTimeoutAudit([file])).toEqual([`fifth.test.ts: "${title}"`]);
    fs.writeFileSync(file, protectedSource);
    expect(caseTimeoutAudit([file])).toEqual([]);
  }
});

it("rejects a literal or unrelated timeout identifier, then clears on restoration", () => {
  const file = fixture(protectedSource);
  for (const substitute of ["5_000", "UNRELATED_TIMEOUT_MS"]) {
    fs.writeFileSync(file, protectedSource.replace('"middle %s", () => {}, SPAWN_TEST_TIMEOUT_MS', `"middle %s", () => {}, ${substitute}`));
    expect(caseTimeoutAudit([file])).toEqual(['fifth.test.ts: "middle %s"']);
    fs.writeFileSync(file, protectedSource);
    expect(caseTimeoutAudit([file])).toEqual([]);
  }
});

import { SPAWN_CHILD_TIMEOUT_MS, SPAWN_TEST_TIMEOUT_MS } from "../support/spawnTestTimeout";

it("keeps the case budget above the former limit and the real child budget", () => {
  const valid = (child: number, test: number) =>
    Number.isFinite(test) && test > 5_000 && child > 0 && child < test;
  const harness = fs.readFileSync(path.join(root, "tests/support/buildMacHarness.ts"), "utf8");
  expect(valid(SPAWN_CHILD_TIMEOUT_MS, SPAWN_TEST_TIMEOUT_MS)).toBe(true);
  expect(valid(SPAWN_TEST_TIMEOUT_MS, SPAWN_TEST_TIMEOUT_MS)).toBe(false);
  expect(harness).toContain("timeout: SPAWN_CHILD_TIMEOUT_MS");
});
