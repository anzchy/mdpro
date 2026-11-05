// @vitest-environment node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";

type Inventory = { cases: unknown[]; assertions: string[]; inputs: string[]; helpers: string[] };
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function isExpectChain(expression: ts.Expression): boolean {
  if (ts.isCallExpression(expression) && ts.isIdentifier(expression.expression) && expression.expression.text === "expect") return true;
  if (ts.isCallExpression(expression) || ts.isPropertyAccessExpression(expression)) return isExpectChain(expression.expression);
  return false;
}

function inventory(file: string): Inventory {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const found: Inventory = { cases: [], assertions: [], inputs: [], helpers: [] };
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement)) found.helpers.push(statement.getText(source));
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) found.helpers.push(declaration.getText(source));
    }
  }
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const call = node.expression;
      if (ts.isIdentifier(call) && call.text === "it") found.cases.push(["it", node.arguments[0]?.getText(source)]);
      else if (ts.isCallExpression(call) && ts.isPropertyAccessExpression(call.expression)
        && call.expression.expression.getText(source) === "it" && call.expression.name.text === "each") {
        found.cases.push(["each", call.arguments[0]?.getText(source), node.arguments[0]?.getText(source)]);
      }
      if (ts.isIdentifier(call) && ["supervisorFixture", "productionWorkerFixture"].includes(call.text)) {
        found.inputs.push(node.getText(source));
      }
    }
    if (ts.isExpressionStatement(node) && isExpectChain(node.expression)) found.assertions.push(node.getText(source));
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

it("GH637-S3 pins every D337 supervisor case, full matcher, fixture input and local helper", () => {
  const found = inventory(path.join(__dirname, "windows-driver-d337-supervisor.test.ts"));
  expect({ cases: found.cases.length, assertions: found.assertions.length, inputs: found.inputs.length, helpers: found.helpers.length }).toEqual({
    cases: 6, assertions: 33, inputs: 6, helpers: 4,
  });
  expect(Object.fromEntries(Object.entries(found).map(([name, value]) => [name, digest(value)]))).toEqual({
    cases: "63438068811f8f0a747010a528d7d98e461e0d1ef66e799fc60b86a5b12a1dea",
    assertions: "60a03d5a9b03adb12c83e989ca6e36f496fe02164e2e8a455d88ba915eeb188d",
    // Only the five synthetic stall rows changed input: DeadlineMs=0 and TimeoutSec=10 make
    // ui-run measure its unchanged ten-second budget from its own start, after pwsh startup.
    inputs: "8dabec43e618b95a965aeecc65a44b942a89f350945776523b26cad041b5e5a2",
    helpers: "b36751ea3bd712c2ae2d02c5ac11aa52609270b0879a922b132d619490f2cfab",
  });
});

it("GH637-S4 pins every D337 production case, full matcher, fixture input and local helper", () => {
  const found = inventory(path.join(__dirname, "windows-driver-d337-production-stalls.test.ts"));
  expect({ cases: found.cases.length, assertions: found.assertions.length, inputs: found.inputs.length, helpers: found.helpers.length }).toEqual({
    cases: 4, assertions: 32, inputs: 4, helpers: 8,
  });
  expect(Object.fromEntries(Object.entries(found).map(([name, value]) => [name, digest(value)]))).toEqual({
    cases: "a40a189ed4b9b315c296507763e409a3dafe10eac5439685f9471426d74e93bb",
    assertions: "0eca4880932d8904ce6d95a29056d27d19de5e50fd5203a859e48edd2582dc8b",
    inputs: "1fcc5c881436eeb512a8b985921440ae88ef93bba06ddda4b77fd83a52f4726d",
    helpers: "ecec3221f0359a79115ccfc13dcac79f9b6730ea74c50b6052d0ade696a65158",
  });
});
