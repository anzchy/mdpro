// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";

const REQUIRED = ["W5", "P1/P2", "E1/E2", "E3", "K5", "W15", "W16", "W17", "W18", "G3"];
const FILE = path.join(process.cwd(), "tests/tooling/t567-receipt-wrapper.test.ts");

it("GH624-S3 keeps every spawn-heavy case in the unit file with an explicit timeout", () => {
  const source = ts.createSourceFile(FILE, fs.readFileSync(FILE, "utf8"), ts.ScriptTarget.Latest, true);
  const cases: { id: string; timeout?: number }[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(source) === "it" && ts.isStringLiteral(node.arguments[0])) {
      const id = REQUIRED.find((value) => (node.arguments[0] as ts.StringLiteral).text.startsWith(`${value} `));
      if (id) {
        const timeout = node.arguments[2];
        cases.push({ id, timeout: timeout && ts.isNumericLiteral(timeout) ? Number(timeout.text) : undefined });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  for (const id of REQUIRED) {
    const matches = cases.filter((entry) => entry.id === id);
    expect(matches, `${id} must occur once in the unit file`).toHaveLength(1);
    expect(matches[0].timeout, `${id} needs an explicit timeout`).toBeGreaterThanOrEqual(15_000);
  }
});
