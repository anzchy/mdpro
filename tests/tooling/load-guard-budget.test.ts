// @vitest-environment node
import { runChild } from "../support/loadGuardChild";
import path from "node:path";
import { expect, it } from "vitest";

it("uses the measured 2 GiB coverage budget and 4 GiB unmeasured budgets", async () => {
  const env = { ...process.env, MDPRO_LOAD_GUARD_BUDGET_GIB: undefined };
  const budget = async (command: string) => (await runChild("python3", [path.resolve("scripts/load-guard/guard.py"), "budget", command], { env, encoding: "utf8" }));
  expect((await budget("pnpm exec vitest run --coverage")).stdout.trim()).toBe("2");
  expect((await budget("cargo test")).stdout.trim()).toBe("4");
});
