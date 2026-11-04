// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";

const IDS = ["G3", "W15", "W16", "W17", "W18"];

function entries(file: string) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const found: { id: string; timeout?: number }[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(source) === "it" && ts.isStringLiteral(node.arguments[0])) {
      const id = IDS.find((value) => (node.arguments[0] as ts.StringLiteral).text.startsWith(`${value} `));
      if (id) {
        const timeout = node.arguments[2];
        found.push({ id, timeout: timeout && ts.isNumericLiteral(timeout) ? Number(timeout.text) : undefined });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

it("GH624-S2 keeps measured and deliberately slow t567 cases only in the slow tier", () => {
  const fast = entries(path.join(process.cwd(), "tests/tooling/t567-receipt-wrapper.test.ts"));
  const slow = entries(path.join(process.cwd(), "tests/tooling/t567-receipt-wrapper.slow.test.ts"));
  for (const id of IDS) {
    expect(fast.filter((entry) => entry.id === id), `${id} remains fast`).toEqual([]);
    const matches = slow.filter((entry) => entry.id === id);
    expect(matches, `${id} must occur once in slow`).toHaveLength(1);
    expect(matches[0].timeout, `${id} needs an explicit timeout`).toBeGreaterThanOrEqual(15_000);
  }
});
