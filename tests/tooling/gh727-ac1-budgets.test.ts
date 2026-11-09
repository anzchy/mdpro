// @vitest-environment node
/**
 * GH727 AC-1: the five named files carry measured budgets and cancel their children through the test's signal.
 * For each file: the spawn-timeout lint finds nothing (C6–C10); every spawning test's timeout is
 * `spawnBudget(<numeric literal>)`, its own or its describe's; every asynchronous spawner call inside it passes
 * `signal`; and every runChild/waitForExit call anywhere in the file passes `signal` (C35), except a waitForExit in a
 * `finally` block, which reaps a group the block has just killed and must not throw when the signal has aborted.
 */
import fs from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { spawnBudget } from "../support/spawnBudget";
// @ts-expect-error -- plain ESM repository script has no declaration file
import { checkSpawnTimeouts } from "../../scripts/lint/spawn-timeouts.mjs";

type Shape = { lint: string[]; offenders: string[]; budgets: Record<string, number> };

/** `spawners`: asynchronous calls that must receive `signal`; `budgeted`: other names whose use marks a spawning test. */
function shape(file: string, spawners: string[], budgeted: string[]): Shape {
  const source = fs.readFileSync(file, "utf8");
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const offenders: string[] = [], budgets: Record<string, number> = {};
  const line = (node: ts.Node) => tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1;
  const calleeName = (call: ts.CallExpression) =>
    ts.isIdentifier(call.expression) ? call.expression.text : ts.isPropertyAccessExpression(call.expression) ? call.expression.name.text : "";
  const mentions = (node: ts.Node, names: string[]): boolean =>
    (ts.isIdentifier(node) && names.includes(node.text)) || (ts.forEachChild(node, (child) => mentions(child, names) || undefined) ?? false);
  const isRegistration = (call: ts.CallExpression) => {
    let callee: ts.Expression = call.expression;
    while (ts.isCallExpression(callee) || ts.isPropertyAccessExpression(callee)) callee = callee.expression;
    return ts.isIdentifier(callee) && (callee.text === "it" || callee.text === "test");
  };
  const measured = (timeout: ts.Node | undefined) =>
    timeout !== undefined && ts.isCallExpression(timeout) && ts.isIdentifier(timeout.expression) && timeout.expression.text === "spawnBudget" &&
    timeout.arguments.length === 1 && ts.isNumericLiteral(timeout.arguments[0]) ? Number(timeout.arguments[0].text) : null;
  /** The budget of the nearest describe whose options are `{ timeout: spawnBudget(<literal>) }`, with its title. */
  const suiteBudget = (node: ts.Node): [string, number] | null => {
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (!ts.isCallExpression(parent) || !/^describe\b/.test(parent.expression.getText(tree))) continue;
      for (const arg of parent.arguments) {
        if (!ts.isObjectLiteralExpression(arg)) continue;
        const option = arg.properties.find((item) => ts.isPropertyAssignment(item) && item.name.getText(tree) === "timeout");
        const ms = option && ts.isPropertyAssignment(option) ? measured(option.initializer) : null;
        if (ms !== null) return [ts.isStringLiteralLike(parent.arguments[0]) ? parent.arguments[0].text : "describe", ms];
      }
    }
    return null;
  };
  const visit = (node: ts.Node) => {
    const reaping = (call: ts.CallExpression) => {
      if (calleeName(call) !== "waitForExit") return false;
      for (let block: ts.Node = call; block.parent; block = block.parent) {
        if (ts.isTryStatement(block.parent) && block.parent.finallyBlock === block) return true;
      }
      return false;
    };
    if (ts.isCallExpression(node) && ["runChild", "waitForExit"].includes(calleeName(node)) && !reaping(node) && !node.arguments.some((arg) => mentions(arg, ["signal"]))) {
      offenders.push(`${line(node)}: ${calleeName(node)} without signal`);
    }
    if (ts.isCallExpression(node) && isRegistration(node)) {
      const callback = node.arguments.find((arg) => ts.isArrowFunction(arg) || ts.isFunctionExpression(arg));
      if (callback && mentions(callback, [...spawners, ...budgeted])) {
        const own = measured(node.arguments[node.arguments.indexOf(callback) + 1]);
        const title = ts.isStringLiteralLike(node.arguments[0]) ? node.arguments[0].text : `line ${line(node)}`;
        const enclosing = own === null ? suiteBudget(node) : null;
        if (own !== null) budgets[title] = own;
        else if (enclosing) budgets[enclosing[0]] = enclosing[1];
        else offenders.push(`${line(node)}: timeout is not spawnBudget(<literal>)`);
        const calls = (inner: ts.Node) => {
          if (ts.isCallExpression(inner) && spawners.includes(calleeName(inner)) && !reaping(inner) && !inner.arguments.some((arg) => mentions(arg, ["signal"]))) {
            offenders.push(`${line(inner)}: ${calleeName(inner)} without signal`);
          }
          ts.forEachChild(inner, calls);
        };
        calls(callback);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return { lint: checkSpawnTimeouts(source, file) as string[], offenders, budgets };
}

describe("GH727 AC-1 budgets and cancellation", () => {
  it("adr141-ci-inventory: measured budgets, profile cancels, and the issue-725 case outlasts its three 5 s probes", () => {
    const result = shape("tests/tooling/adr141-ci-inventory.test.ts", ["profile"], ["hasPrerequisite"]);
    const probes = result.budgets["local verifier probes Codex availability before its inventory run"] ?? 0;
    expect([result.lint, result.offenders, Object.keys(result.budgets).length, spawnBudget(probes) >= 20_000]).toEqual([[], [], 2, true]);
  });

  it("adr0141-wi2-route-guard: a measured budget on each describe, and run() cancels through the test's signal", () => {
    const result = shape("tests/tooling/adr0141-wi2-route-guard.test.ts", [], ["route", "notify", "run"]);
    const source = fs.readFileSync("tests/tooling/adr0141-wi2-route-guard.test.ts", "utf8");
    expect([result.lint, result.offenders, Object.keys(result.budgets).length, /\brunChild\(/.test(source)]).toEqual([[], [], 2, true]);
  });

  it("load-guard-build-only: a measured budget, and every backstop tick cancels through the test's signal", () => {
    const result = shape("tests/tooling/load-guard-build-only.test.ts", ["runChild"], ["sleeper"]);
    expect([result.lint, result.offenders, Object.keys(result.budgets).length]).toEqual([[], [], 1]);
  });

  it("d183-build-mac-product-checks: each budget outlasts the 30 s synchronous build cap plus its probe, and the probe is capped", () => {
    const file = "tests/tooling/d183-build-mac-product-checks.test.ts";
    const result = shape(file, [], ["run", "spawnSync"]);
    const source = fs.readFileSync(file, "utf8");
    const uncapped = [...source.matchAll(/spawnSync\([^)]*\)/g)].filter((call) => !/timeout:/.test(call[0])).map((call) => call[0]);
    const short = Object.entries(result.budgets).filter(([, ms]) => spawnBudget(ms) <= 30_000 + 10_000).map(([title]) => title);
    expect([result.lint, result.offenders, Object.keys(result.budgets).length, short, uncapped]).toEqual([[], [], 11, [], []]);
  });

  it("load-guard-backstop: measured budgets on every spawning test, and every tick and wait cancels through the test's signal", () => {
    const result = shape("tests/tooling/load-guard-backstop.test.ts", ["runChild", "waitForExit", "registeredWrapperScenario"], ["spawn"]);
    expect([result.lint, result.offenders, Object.keys(result.budgets).length]).toEqual([[], [], 7]);
  });
});
