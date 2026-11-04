// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";

const ROOT = process.cwd();
const REQUIRED = ["W5", "E1/E2", "E3", "K5", "P1/P2"];

function cases(file: string) {
  if (!fs.existsSync(file)) return [];
  const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const found: { id: string; timeout?: number }[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(source) === "it" && node.arguments.length >= 2) {
      const title = node.arguments[0];
      if (ts.isStringLiteral(title)) {
        const id = REQUIRED.find((candidate) => title.text.startsWith(`${candidate} `));
        if (id) {
          const timeout = node.arguments[2];
          found.push({ id, timeout: timeout && ts.isNumericLiteral(timeout) ? Number(timeout.text) : undefined });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

it("GH624-S1 keeps every spawn-heavy t567 case once in the slow tier with an explicit timeout", () => {
  const fast = cases(path.join(ROOT, "tests/tooling/t567-receipt-wrapper.test.ts"));
  const slow = cases(path.join(ROOT, "tests/tooling/t567-receipt-wrapper.slow.test.ts"));
  for (const id of REQUIRED) {
    expect(fast.filter((entry) => entry.id === id), `${id} remains in the fast tier`).toEqual([]);
    const matches = slow.filter((entry) => entry.id === id);
    expect(matches, `${id} must occur exactly once in the slow tier`).toHaveLength(1);
    expect(matches[0].timeout, `${id} needs an explicit per-test timeout`).toBeGreaterThanOrEqual(15_000);
  }
});
