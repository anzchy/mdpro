// @vitest-environment node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";

const target = join(process.cwd(), "tests/tooling/adr128-conditional-lint.test.ts");

function inventory() {
  const tree = ts.createSourceFile(target, readFileSync(target, "utf8"), ts.ScriptTarget.Latest, true);
  const titles: Array<[string | undefined, string | undefined, string]> = [];
  let caseCount = 0;
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node)) {
      const expression = node.expression;
      const plain = ts.isIdentifier(expression) && expression.text === "it";
      const each = ts.isCallExpression(expression) && ts.isPropertyAccessExpression(expression.expression) &&
        ts.isIdentifier(expression.expression.expression) && expression.expression.expression.text === "it" && expression.expression.name.text === "each";
      if (plain || each) {
        const rows = each ? expression.arguments[0] : undefined;
        const count = rows && ts.isArrayLiteralExpression(rows) ? rows.elements.length : 1;
        titles.push([node.arguments[0]?.getText(tree), rows?.getText(tree), ""]);
        caseCount += count;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return { caseCount, titleHash: createHash("sha256").update(JSON.stringify(titles)).digest("hex") };
}

it("keeps the 78 original conditional-lint cases and titles", () => {
  expect(inventory()).toEqual({
    caseCount: 78,
    titleHash: "40f12ccf383dacbb0190dfd38137f7e50bda5aab178fcc62443d7580f1e42750",
  });
});
