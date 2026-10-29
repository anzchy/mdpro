// @vitest-environment node
import fs from "node:fs";
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
  const file = path.join(fs.mkdtempSync(path.join(root, "tests/.d332-timeout-")), "fifth.test.ts");
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
    const sharedName = "SPAWN_TEST_TIMEOUT_MS";
    const sharedModule = path.join(root, "tests/support/spawnTestTimeout.ts");
    const relativeModule = path.relative(path.dirname(file), sharedModule).replace(/\.ts$/, "");
    const expectedSpecifier = relativeModule.startsWith("..") ? relativeModule : `./${relativeModule}`;
    const matchingImports = ast.statements.flatMap((statement) =>
      ts.isImportDeclaration(statement)
      && ts.isStringLiteral(statement.moduleSpecifier)
      && statement.moduleSpecifier.text === expectedSpecifier
      && path.resolve(path.dirname(file), `${statement.moduleSpecifier.text}.ts`) === sharedModule
      && !!statement.importClause?.namedBindings
      && ts.isNamedImports(statement.importClause.namedBindings)
        ? statement.importClause.namedBindings.elements.filter((element) =>
          (element.propertyName?.text ?? element.name.text) === sharedName)
        : [],
    );
    const sharedLocalName = matchingImports.length === 1 ? matchingImports[0].name.text : undefined;
    let shadowed = false;
    function declaresSharedName(name: ts.BindingName): boolean {
      if (ts.isIdentifier(name)) return name.text === sharedLocalName;
      return name.elements.some((element) => ts.isBindingElement(element) && declaresSharedName(element.name));
    }
    function findShadow(node: ts.Node): void {
      if ((ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isBindingElement(node))
        && declaresSharedName(node.name)) shadowed = true;
      if (ts.isCatchClause(node) && node.variableDeclaration && declaresSharedName(node.variableDeclaration.name)) shadowed = true;
      if (ts.isImportSpecifier(node) && node.name.text === sharedLocalName
        && !matchingImports.includes(node)) shadowed = true;
      ts.forEachChild(node, findShadow);
    }
    findShadow(ast);
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
          if (!sharedLocalName || shadowed || !timeout || !ts.isIdentifier(timeout) || timeout.text !== sharedLocalName) {
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

const protectedSource = `import { SPAWN_TEST_TIMEOUT_MS } from "../support/spawnTestTimeout";\n`
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

it("rejects a renamed child budget and restores the named import", () => {
  const file = fixture(protectedSource);
  fs.writeFileSync(file, protectedSource.replace("{ SPAWN_TEST_TIMEOUT_MS }", "{ SPAWN_CHILD_TIMEOUT_MS as SPAWN_TEST_TIMEOUT_MS }"));
  expect(caseTimeoutAudit([file])).toEqual(['fifth.test.ts: "first"', 'fifth.test.ts: "middle %s"', 'fifth.test.ts: "last"']);
  fs.writeFileSync(file, protectedSource);
  expect(caseTimeoutAudit([file])).toEqual([]);
});

it("accepts an alias of the exported shared timeout when the case uses it", () => {
  const file = fixture(protectedSource.replaceAll("SPAWN_TEST_TIMEOUT_MS", "CASE_BUDGET")
    .replace("{ CASE_BUDGET }", "{ SPAWN_TEST_TIMEOUT_MS as CASE_BUDGET }"));
  expect(caseTimeoutAudit([file])).toEqual([]);
});

it("rejects block and file shadows of the shared timeout", () => {
  const file = fixture(protectedSource);
  for (const shadow of [
    'const SPAWN_TEST_TIMEOUT_MS = 5_000;\n',
    'if (true) { const SPAWN_TEST_TIMEOUT_MS = 5_000; }\n',
  ]) {
    fs.writeFileSync(file, protectedSource + shadow);
    expect(caseTimeoutAudit([file])).toEqual(['fifth.test.ts: "first"', 'fifth.test.ts: "middle %s"', 'fifth.test.ts: "last"']);
  }
  fs.writeFileSync(file, protectedSource);
  expect(caseTimeoutAudit([file])).toEqual([]);
});

it("rejects parameter and destructuring shadows", () => {
  const file = fixture(protectedSource);
  for (const declaration of [
    'function run(SPAWN_TEST_TIMEOUT_MS: number) {}\n',
    'const { SPAWN_TEST_TIMEOUT_MS } = { SPAWN_TEST_TIMEOUT_MS: 5_000 };\n',
  ]) {
    fs.writeFileSync(file, protectedSource + declaration);
    expect(caseTimeoutAudit([file])).toEqual(['fifth.test.ts: "first"', 'fifth.test.ts: "middle %s"', 'fifth.test.ts: "last"']);
  }
});

it("rejects a same-named import from another module", () => {
  const file = fixture(protectedSource);
  fs.writeFileSync(file, protectedSource.replace("../support/spawnTestTimeout", "../fixtures/spawnTestTimeout"));
  expect(caseTimeoutAudit([file])).toEqual(['fifth.test.ts: "first"', 'fifth.test.ts: "middle %s"', 'fifth.test.ts: "last"']);
  fs.writeFileSync(file, protectedSource);
  expect(caseTimeoutAudit([file])).toEqual([]);
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
