// @vitest-environment node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";

const DISPATCH_FILE = path.join(__dirname, "windows-driver-native-dispatch.test.ts");
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

it("GH637-S2 pins the native dispatch case and assertion inventory", () => {
  const source = ts.createSourceFile(DISPATCH_FILE, readFileSync(DISPATCH_FILE, "utf8"), ts.ScriptTarget.Latest, true);
  const cases: unknown[] = [];
  const assertions: string[] = [];
  let focusOps = "";

  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === "focusOps") {
      focusOps = node.initializer?.getText(source) ?? "";
    }
    if (ts.isCallExpression(node)) {
      const call = node.expression;
      if (ts.isIdentifier(call) && call.text === "expect") assertions.push(node.getText(source));
      if (ts.isIdentifier(call) && call.text === "it") {
        cases.push(["it", node.arguments[0]?.getText(source)]);
      } else if (ts.isCallExpression(call) && ts.isPropertyAccessExpression(call.expression)
        && call.expression.expression.getText(source) === "it" && call.expression.name.text === "each") {
        cases.push(["each", call.arguments[0]?.getText(source), node.arguments[0]?.getText(source)]);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  expect(cases).toHaveLength(42);
  expect(hash(cases)).toBe("cf3ea77c587c3dc1480b4eedaf4f72bcb1e58c435782df94ce87e2b23c4ec590");
  expect(hash([focusOps, cases])).toBe("6ce12fe455b6dc8cfdc3e0d81e069cf5fdc2e3491f67cb29ec0a4f68ed36afe5");
  expect(hash(assertions)).toBe("d3ed6b3a7a460c32a7da7495ea5708bd9f006a9c9e4c97881261f3be766db357");
});
