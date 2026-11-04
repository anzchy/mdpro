// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";

const REQUIRED = [
  "W1 frontend-record reaches the entry through the guard",
  "W2 frontend-verify reaches the entry through the guard with the id only",
  "W5 reaches no cargo and no other script in any mode, and the wrapper names neither",
  "W6 the entry runs as the repository's own script, in its top directory",
  "W7 exits with the entry's status, through the guard and directly",
  "W10 keeps a CJK, spaced test path and a suffixed id as single arguments",
  "W11 takes --test before --id the same way",
  "W12 runs no shell: metacharacters in the id and the path arrive as bytes and run nothing",
  "W13 never exits 0 when the receipt command is killed by a signal",
  "P1/P2 by its .agents path and by its .claude/skills symlink path, it reaches the cwd's repository, not the worktree's",
  "P4 from inside a linked worktree, it runs that worktree's entry in that worktree's top",
  "P5 ignores look-alike scripts in a non-git subdirectory between the cwd and the top",
  "E1/E2 adds, removes and changes no variable: CJK and empty values kept, absent tuning variables stay absent",
  "E3 passes present tuning variables on byte-equal",
  "K5 each wrapper call in SKILL.md, run as written from the repository top, reaches its mode's command",
  "W15 on SIGTERM the receipt command drains before the wrapper exits, and nothing runs late",
  "W16 SIGINT is passed on as itself, through the guard and directly",
  "W17 a signal that arrives before the receipt command starts leaves nothing running and is never success",
  "W18 SIGHUP is passed on as SIGTERM, the one the guard traps, so the guard still drains its job",
  "G3 no mode by either wrapper path escapes the stub repository, and this worktree's receipt store is untouched",
];
const FILE = path.join(process.cwd(), "tests/tooling/t567-receipt-wrapper.test.ts");

it("GH624-S4 keeps measured cases active with exact titles and explicit timeouts", () => {
  const source = ts.createSourceFile(FILE, fs.readFileSync(FILE, "utf8"), ts.ScriptTarget.Latest, true);
  const cases: { title: string; timeout?: number }[] = [];
  const disabled: string[] = [];
  const root = (node: ts.Node): string | undefined => {
    if (ts.isIdentifier(node)) return node.text;
    if (ts.isPropertyAccessExpression(node)) return root(node.expression);
    if (ts.isCallExpression(node)) return root(node.expression);
    return undefined;
  };
  const visit = (node: ts.Node) => {
    if (ts.isPropertyAccessExpression(node) && ["skip", "only", "todo"].includes(node.name.text)
      && ["it", "test", "describe"].includes(root(node.expression) ?? "")) {
      disabled.push(node.getText(source));
    }
    if (ts.isCallExpression(node) && node.expression.getText(source) === "it" && ts.isStringLiteral(node.arguments[0])) {
      const title = (node.arguments[0] as ts.StringLiteral).text;
      if (REQUIRED.includes(title)) {
        const timeout = node.arguments[2];
        cases.push({ title, timeout: timeout && ts.isNumericLiteral(timeout) ? Number(timeout.text) : undefined });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  expect(disabled, "no it, test or describe may be skipped, focused or todo").toEqual([]);
  for (const title of REQUIRED) {
    const matches = cases.filter((entry) => entry.title === title);
    expect(matches, `${title} must occur once in the unit file`).toHaveLength(1);
    expect(matches[0].timeout, `${title} needs an explicit timeout`).toBeGreaterThanOrEqual(15_000);
  }
});
