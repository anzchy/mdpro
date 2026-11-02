/** Purpose: types for the land-guard exports that tests/tooling/codex-land-guard-docs.test.ts and
 *  tests/tooling/codex-land-guard-export.test.ts import. */
export function ruleTestCommand(env?: NodeJS.ProcessEnv): [string, string[]];
export function ruleTestSpawn(env?: NodeJS.ProcessEnv): [string, string[]];
export function runRuleTests(tree: string, env?: NodeJS.ProcessEnv): { status: number; output: string };
export function land(argv?: string[]): void;
