// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const workers = [
  "tests/tooling/adr0098-apply.test.ts",
  "tests/tooling/unit-red-phase-advanced.test.ts",
  "tests/tooling/unit-red-lane.test.ts",
  "tests/tooling/unit-red-phase.test.ts",
  "tests/tooling/red-receipt.test.ts",
  "tests/tooling/unit-red-phase-soft.test.ts",
];
function blockingCalls(file: string) {
  const source = ts.createSourceFile(file, fs.readFileSync(path.join(root, file), "utf8"), ts.ScriptTarget.Latest, true);
  const result: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && ["spawnSync", "execSync", "execFileSync"].includes(node.expression.text)) {
      result.push(`${file}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return result;
}
describe("D302 long-running worker files yield during child processes", () => {
  it("has no synchronous child-process call on the selected worker paths", () => {
    expect(workers.flatMap(blockingCalls)).toEqual([]);
  });
});
