// @vitest-environment node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";

const target = join(process.cwd(), "tests/tooling/windows-driver-d336-dialog-receipt.test.ts");

function inventory() {
  const tree = ts.createSourceFile(target, readFileSync(target, "utf8"), ts.ScriptTarget.Latest, true);
  const titles: Array<[string | undefined, undefined, string]> = [];
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "it") {
      titles.push([node.arguments[0]?.getText(tree), undefined, ""]);
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return { caseCount: titles.length, titleHash: createHash("sha256").update(JSON.stringify(titles)).digest("hex") };
}

it("keeps the seven original dialog-receipt cases and titles", () => {
  expect(inventory()).toEqual({
    caseCount: 7,
    titleHash: "1c6091b753942e0f9d03b01119b612656c8a179db12448719cca0070fe83739d",
  });
});
